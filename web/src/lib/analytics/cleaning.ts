import { parseNumber } from './numbers';
export { parseNumber } from './numbers';
import { inferMapping, parseDate, type Cell, type Dataset } from './analytics';
import type { RawSheet, RawRow, ImportReport, FinancialMetric } from './import-types';
export const normalize=(v:Cell|undefined)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\u00a0\u202f]/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
const months=['janvier|january|jan','fevrier|february|feb|fev','mars|march|mar','avril|april|apr|avr','mai|may','juin|june|jun','juillet|july|jul','aout|august|aug','septembre|september|sep|sept','octobre|october|oct','novembre|november|nov','decembre|december|dec'];
function colName(index:number){let s='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
const cellRef=(sheet:RawSheet,row:number,col:number)=>`${sheet.name}!${colName(col)}${row}`;
const financialHeaders=['Period','Metric','Amount','Category','Currency','Unit','Basis','Source'];
function reportFor(sheet:RawSheet,header:RawRow,layout:ImportReport['layout']):ImportReport {
 const maxCol=Math.max(...sheet.rows.map(r=>r.values.length),1);
 return {layout,sheet:sheet.name,range:`A${header.row}:${colName(maxCol-1)}${sheet.rows.at(-1)?.row||header.row}`,headerRow:header.row,originalRows:sheet.originalRows,activeRows:sheet.rows.length,ignoredFormattedRows:Math.max(0,sheet.originalRows-sheet.rows.length),changes:[],issues:[...sheet.issues],preview:sheet.rows.slice(0,10).map(r=>({row:r.row,cells:r.values.slice(0,12)})),duplicateRows:0,formulaCount:sheet.formulaCount,formulaErrors:sheet.formulaErrors,missingFormulaResults:sheet.missingFormulaResults};
}
function finish(dataset:Dataset){const report=dataset.report!;if(report.ignoredFormattedRows)report.changes.push(`Ignored ${report.ignoredFormattedRows.toLocaleString()} empty or formatting-only rows.`);if(report.headerRow>1)report.changes.push(`Detected headers at row ${report.headerRow}; introductory rows were not treated as records.`);if(report.formulaCount)report.changes.push(`Read ${report.formulaCount.toLocaleString()} stored formula results. Formulas were not recalculated.`);if(report.formulaErrors)report.issues.push({severity:'warning',message:`${report.formulaErrors} formula errors on this sheet. Error cells remain missing; no replacement values were invented.`});if(report.missingFormulaResults)report.issues.push({severity:'warning',message:`${report.missingFormulaResults} formulas have no stored result. Recalculate and save in Excel to supply these values.`});return dataset;}
function detectCurrency(text:string,format='',symbols=false){const s=text+' '+format;if(/\bCDF\b|\bFC\b/i.test(s))return 'CDF';if(/\bUSD\b|\[\$\$-409\]/i.test(s))return 'USD';if(/\bEUR\b|€/i.test(s))return 'EUR';if(/\bGBP\b|£/i.test(s))return 'GBP';const named=s.match(/\b(CAD|AUD|XOF|XAF)\b/i);if(named)return named[1].toUpperCase();if(symbols&&/\$/.test(s))return 'DOLLAR';return 'UNSPECIFIED';}
function ledger(sheet:RawSheet,name:string):Dataset|null {
 const header=sheet.rows.find(r=>r.values.some(v=>/^(date|dates)$/.test(normalize(v)))&&r.values.some(v=>/\b(entrees?|sorties?|receipts|payments|debit|credit)\b/.test(normalize(v))));
 if(!header)return null;
 const dateCol=header.values.findIndex(v=>/^(date|dates)$/.test(normalize(v))),descCol=header.values.findIndex(v=>/libell|description|memo/.test(normalize(v))),categoryCol=header.values.findIndex(v=>/^code interne$|^category$|^categorie$/.test(normalize(v)));
 const specs=header.values.flatMap((v,col)=>{const text=normalize(v);let role:FinancialMetric['role'];if(/entree|receipt|credit/.test(text))role='receipts';else if(/sortie|payment|debit/.test(text))role='payments';else if(/solde|balance/.test(text))role='balance';else return [];const currency=detectCurrency(String(v));const label={receipts:'Cash receipts',payments:'Cash payments',balance:'Closing balance'}[role];return [{col,metric:{id:`${label} · ${currency}`,label:`${label} · ${currency}`,currency,unit:'currency' as const,aggregation:role==='balance'?'last' as const:'sum' as const,role}}];});
 if(!specs.some(s=>s.metric.role==='receipts')||!specs.some(s=>s.metric.role==='payments'))return null;
 const rows:Cell[][]=[];const report=reportFor(sheet,header,'ledger');let excluded=0,openings=0;const metrics:FinancialMetric[]=specs.map(s=>s.metric);
 for(const r of sheet.rows.filter(r=>r.row>header.row)){
  const date=parseDate(r.values[dateCol],'DMY');if(!date){excluded++;continue;}
  const desc=String(r.values[descCol]??'').trim(),opening=r.values.slice(0,Math.min(...specs.map(s=>s.col))).some(v=>/^(report|report a nouveau|solde initial|solde d'ouverture|opening balance)$/i.test(normalize(v)));
  if(opening)openings++;
  for(const spec of specs){const value=parseNumber(r.values[spec.col]);if(value===null)continue;
   if(opening&&spec.metric.role==='payments')continue;
   let metric:FinancialMetric=spec.metric;if(opening&&spec.metric.role==='receipts'){const id=`Opening balance · ${metric.currency}`;metric={...metric,id,label:id,role:'opening',aggregation:'last'};if(!metrics.some(m=>m.id===id))metrics.push(metric);}
   rows.push([date,metric.id,value,normalize(r.values[categoryCol]).toUpperCase()||'Uncategorized',metric.currency,metric.unit,'Recorded',cellRef(sheet,r.row,spec.col)]);
  }
 }
 report.changes.push('Trimmed category codes and normalized letter case for consistent grouping.','Separated receipts, payments, and balances by currency. Currencies are never added together.','Running balances use the last recorded value in each period; they are never summed.');
 if(openings)report.changes.push(`Kept ${openings} opening-balance row separately from cash receipts and payments.`);
 if(excluded)report.changes.push(`Excluded ${excluded} undated footer/header rows from cash movements.`);
 report.issues.push({severity:'warning',message:'Currency streams may include linked transfers or equivalent entries. Do not convert and add CDF and USD streams into one spending total.'});
 report.issues.push({severity:'info',message:'Cash receipts are not necessarily sales revenue. Transfers and financing remain recorded cash movements.'});
 return rows.length?finish({name,kind:'financial',headers:financialHeaders,rows,sheet:sheet.name.trim(),report,financial:{metrics,granularity:'daily',basis:'recorded',title:'Cash book'}}):null;
}
type Period={col:number;period:string;currency?:string;submeasure?:string};
type Candidate={header:RawRow;periods:Period[];granularity:'annual'|'monthly';yearConflict:boolean};
function findPeriods(sheet:RawSheet):Candidate[]{
 const result:Candidate[]=[];
 for(const r of sheet.rows){
  const monthly:Period[]=[],annual:Period[]=[];
  for(let col=0;col<r.values.length;col++){
   const value=r.values[col],s=normalize(value).replace(/\.$/,'');
   if(/^20\d{2}$/.test(s)){annual.push({col,period:s});continue;}
   const date=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;
   if(date){monthly.push({col,period:date.slice(0,7)});continue;}
   const month=months.findIndex(m=>new RegExp(`^(?:${m})(?:[ /-]+20\\d{2})?$`).test(s));if(month<0)continue;
   let year=s.match(/20\d{2}/)?.[0];
   if(!year){for(const prev of sheet.rows.filter(x=>x.row<=r.row&&x.row>=r.row-8).reverse()){const above=normalize(prev.values[col]);if(/^20\d{2}$/.test(above)){year=above;break;}const title=prev.values.slice(0,col).map(normalize).join(' ');const years=title.match(/20\d{2}/g);if(years?.length===1){year=years[0];break;}}}
   if(year)monthly.push({col,period:`${year}-${String(month+1).padStart(2,'0')}`});
  }
  if(monthly.length<3&&new Set(annual.map(p=>p.period)).size<2)continue;
  const titleYears=sheet.rows.filter(x=>x.row<r.row&&x.row>=r.row-5).flatMap(x=>x.values.filter(v=>typeof v==='string'&&!/^\d{4}-/.test(v)).flatMap(v=>String(v).match(/20\d{2}/g)||[]));
  if(monthly.length>=3&&new Set(monthly.map(p=>p.period)).size===monthly.length){
   const currencies=sheet.rows.filter(x=>x.row>r.row&&x.row<=r.row+3).find(x=>x.values.some(v=>/^(cdf|usd|eur|gbp|cad|aud)$/.test(normalize(v))));
   const expanded:Period[]=[];
   for(let i=0;i<monthly.length;i++){const p=monthly[i],end=monthly[i+1]?.col||p.col+3;const matches=currencies?currencies.values.slice(p.col,end).map((v,j)=>({col:p.col+j,currency:detectCurrency(String(v))})).filter(x=>x.currency!=='UNSPECIFIED'):[];if(matches.length)for(const m of matches)expanded.push({...p,...m});else expanded.push(p);}
   result.push({header:r,periods:expanded,granularity:'monthly',yearConflict:titleYears.length>0&&!monthly.some(p=>titleYears.includes(p.period.slice(0,4)))});
  } else if(new Set(annual.map(p=>p.period)).size>=2&&r.values.every(v=>typeof v!=='number'||/^20\d{2}$/.test(String(v)))){
   let selected=annual.filter(p=>!sheet.rows.filter(x=>x.row>r.row&&x.row<=r.row+5).some(x=>months.some(m=>new RegExp(`^(?:${m})$`).test(normalize(x.values[p.col])))));
   const duplicated=selected.length!==new Set(selected.map(p=>p.period)).size;
   if(duplicated){const sub=sheet.rows.find(x=>x.row===r.row+1);const known=selected.every(p=>{const tag=sub?.values[p.col];return typeof tag==='string'&&tag.trim()&&tag.trim().length<35;});
    if(known)selected=selected.map(p=>({...p,submeasure:String(sub!.values[p.col]).trim()}));
    else {if(!sheet.issues.some(i=>i.message.includes('Repeated year')))sheet.issues.push({severity:'warning',message:'Repeated year columns have ambiguous subheaders. This matrix needs explicit restructuring; no automatic year totals were created.'});continue;}
   }
   if(new Set(selected.map(p=>p.period)).size>=2)result.push({header:r,periods:selected,granularity:'annual',yearConflict:false});
  }
 }
 return result;
}
function matrices(sheet:RawSheet,name:string):Dataset[]{
 const candidates=findPeriods(sheet);const datasets:Dataset[]=[];
 for(const candidate of candidates){
  const {header,periods,granularity}=candidate;const startCol=Math.min(...periods.map(p=>p.col));if(startCol===0)continue;
  const next=candidates.find(c=>c.header.row>header.row&&c.granularity===granularity);const end=next?.header.row||Infinity;
  const report=reportFor(sheet,header,'matrix'),metrics:FinancialMetric[]=[],rows:Cell[][]=[];
  const context=sheet.rows.filter(r=>r.row<=header.row).flatMap(r=>r.values.filter(v=>typeof v==='string')).join(' ');
  const basis=/projec|estim|prevision|budget|simulation|investissement|opex 20/i.test(context)?'projection' as const:'unspecified' as const;
  let section='';
  for(const r of sheet.rows.filter(r=>r.row>header.row&&r.row<end)){
   const labels=r.values.slice(0,startCol).map((v,i)=>({text:typeof v==='string'?v.trim():'',col:i})).filter(v=>v.text&&!/^#|^\d{4}-\d{2}-\d{2}$/.test(v.text));
   if(!labels.length)continue;
   const label=labels[0].text;
   if(/^(description|unite|date|dates|libelles|montant)$/i.test(normalize(label)))continue;
   const nums=periods.map(p=>({p,value:parseNumber(r.values[p.col])})).filter(x=>x.value!==null);
   if(!nums.length){if(labels.length===1&&!findPeriods({...sheet,rows:[r]}).length)section=label;continue;}
   if(r.row===header.row||candidates.some(c=>c.header.row===r.row))continue;
   // A row is one series. Total rows remain distinct series and are never added to detail rows.
   const subtotal=/sous.?total|sub.?total|^total\b|^gt$|^grand total/.test(normalize(label));
   let baseLabel=subtotal&&section&&!/grand total|total site|depenses totales|grand.?total/.test(normalize(label))?`${label} · ${section}`:label;
   const groups=new Map<string,typeof nums>();for(const entry of nums){const key=[entry.p.currency||'',entry.p.submeasure||''].filter(Boolean).join(' · ');groups.set(key,[...(groups.get(key)||[]),entry]);}
   for(const [suffix,entries] of groups){
    let metricLabel=baseLabel+(suffix?' · '+suffix:'');if(metrics.some(m=>m.label===metricLabel))metricLabel+=` (row ${r.row})`;
    const format=entries.map(x=>r.formats[x.p.col]||'').find(f=>f.includes('%'))||entries.map(x=>r.formats[x.p.col]||'').find(f=>/\$|€|£/.test(f))||'';
    // Explicit currency headers win over display formats, which can be misleading.
    const currency=entries[0].p.currency||detectCurrency(label,/\[\$\$-409\]/.test(format)?format:'');
    const isPercent=format.includes('%')||label.includes('%');
    const isRatio=/taux|rate|moyenn|average|par |per |\//.test(normalize(label+' '+suffix));
    const unit=isPercent?'percent' as const:/hectare|production (ffb|cpo)|^ha\b|jours|nombre|plants|t regime|t\/ha/.test(normalize(label+' '+suffix))?'number' as const:/revenu|revenue|opex|capex|depense|balance|solde|cout|montant|salaire|frais|cash|expense|cost/.test(normalize(label))||currency!=='UNSPECIFIED'?'currency' as const:'number' as const;
    const id=metricLabel;metrics.push({id,label:metricLabel,currency,unit,aggregation:isRatio||isPercent||/balance|solde/.test(normalize(label))?'last':'sum'});
    for(const {p,value} of entries){const amount=isPercent&&!String(r.formats[p.col]||'').includes('%')&&label.includes('%')?value!/100:value;rows.push([p.period,id,amount,section||label,currency,unit,basis==='projection'?'Projection / plan':'Unspecified',cellRef(sheet,r.row,p.col)]);}
   }
  }
  if(!rows.length)continue;
  if(metrics.some(m=>m.unit==='percent'||m.aggregation==='last'))report.changes.push('Kept balances, percentages, and per-unit rates non-additive; headline values use the latest period.');
  report.changes.push(`Converted ${periods.length} ${granularity==='annual'?'year':'month'} columns into ${rows.length} period/value records.`,`Kept ${metrics.length} measures separate. Subtotals and their components are not added together.`, 'Kept source cell references for every extracted value.');
  if(granularity==='monthly')report.changes.push('Excluded annual and grand-total columns from the monthly series.');
  if(candidate.yearConflict)report.issues.push({severity:'warning',message:'The year in the date headers conflicts with a nearby title. Header dates are preserved; confirm the reporting year in the source workbook.',source:`${sheet.name}!row ${header.row}`});
  if(basis==='projection')report.issues.push({severity:'info',message:'This sheet contains a projection, budget, or plan. Figures are not labeled as realized sales.'});
  const projectedSpan=normalize(context).match(/de\s+(20\d{2})\s+a\s+(20\d{2})/);if(basis==='projection'&&projectedSpan){const before=rows.filter(r=>String(r[0]).slice(0,4)<projectedSpan[1]);if(before.length){for(const r of before)r[6]='Baseline / basis unspecified';report.issues.push({severity:'info',message:`Periods before ${projectedSpan[1]} are preserved as baseline figures; their actual/projection status is not assumed.`});}}
  if(periods.some(p=>p.currency==='USD')){const rates=sheet.rows.filter(r=>r.row>header.row&&r.row<=header.row+3&&r.values.slice(0,startCol).every(v=>v===null||v==='')).flatMap(r=>periods.filter(p=>p.currency==='USD').map(p=>r.values[p.col])).filter(v=>typeof v==='number'&&v>10);if(rates.length&&new Set(rates).size===1)report.issues.push({severity:'warning',message:`USD columns have a source conversion-rate row (${rates[0]}). Treat them as source-converted equivalents, separate from actual USD cash-book movements. The pipeline did not convert or combine currencies.`});}
  if(metrics.some(m=>m.unit==='currency'&&m.currency==='UNSPECIFIED'))report.issues.push({severity:'warning',message:'Currency is not specified for some measures. Values are shown in reported units until you confirm a currency.'});
  if(metrics.some(m=>m.currency==='USD')&&!periods.some(p=>p.currency==='USD'))report.issues.push({severity:'warning',message:'USD is inferred from explicit labels or the US-dollar number format. Confirm the source currency; no conversion is applied.'});
  if(metrics.some(m=>m.unit==='percent'))report.issues.push({severity:'info',message:'Percentage series are displayed by period and are not summed across time.'});
  const zeroOnly=[...new Set(rows.map(r=>String(r[0])))].filter(period=>{const entries=rows.filter(r=>r[0]===period);return entries.length>0&&entries.every(r=>r[2]===0)&&entries.every(r=>{const ref=String(r[7]),rowNum=Number(ref.match(/(\d+)$/)?.[1]),raw=sheet.rows.find(x=>x.row===rowNum);const column=ref.split('!').at(-1)!.replace(/\d/g,'');let ci=0;for(const char of column)ci=ci*26+char.charCodeAt(0)-64;return !!raw?.formulas[ci-1];});});
  if(zeroOnly.length){for(const r of rows)if(zeroOnly.includes(String(r[0])))r[6]='Unconfirmed template period';report.issues.push({severity:'warning',message:`${zeroOnly.join(', ')} contain only zero-valued formulas with no populated nonzero measures. These periods are retained in prepared data but excluded from insights until confirmed in the source.`});}
  const result=finish({name,kind:'financial',headers:financialHeaders,rows,sheet:`${sheet.name.trim()} · ${granularity==='annual'?'Years':'Months'} · row ${header.row}`,report,financial:{metrics,granularity,basis,title:granularity==='annual'?'Annual financial series':'Monthly financial series'}});datasets.push(result);
 }
 return datasets;
}
function table(sheet:RawSheet,name:string):Dataset|null {
 let best:{r:RawRow;score:number}|undefined;
 for(const r of sheet.rows.slice(0,100)){
  const strings=r.values.filter(v=>typeof v==='string'&&v.trim()).length;if(strings<2)continue;
  const mapping=inferMapping(r.values.map(v=>String(v??''))),next=sheet.rows.filter(x=>x.row>r.row).slice(0,6);
  const score=(mapping.date?15:0)+(mapping.revenue?15:0)+(mapping.region?3:0)+Math.min(strings,10)+next.filter(x=>x.values.some(v=>typeof v==='number'||parseNumber(v)!==null)).length;
  if(!best||score>best.score)best={r,score};
 }
 if(!best)return null;const header=best.r;
 const maxColumn=Math.max(...sheet.rows.map(r=>r.values.length));const used=Array.from({length:maxColumn},(_,i)=>({v:header.values[i]??null,i})).filter(x=>x.v!==null&&x.v!==''||sheet.rows.some(r=>r.row>header.row&&r.values[x.i]!==undefined&&r.values[x.i]!==null&&r.values[x.i]!==''));if(used.length<2)return null;
 const counts=new Map<string,number>();const headers=used.map(({v,i})=>{const label=String(v===null||v===''?`Column ${colName(i)}`:v).replace(/\s+/g,' ').trim(),count=(counts.get(normalize(label))||0)+1;counts.set(normalize(label),count);return count>1?`${label} (${count})`:label;});
 const currencyEvidence:Record<string,string[]>={};
 const report=reportFor(sheet,header,'table');let repeated=0,trimmed=0,converted=0;if(used.some(x=>x.v===null||x.v===''))report.changes.push('Named blank headers by source column; populated columns were preserved.');
 const numericIndexes=new Set(used.filter(x=>/revenue|revenu|sales|montant|amount|cout|cost|prix|price|total|quantity|quantite|qte|solde/.test(normalize(x.v))).map(x=>x.i));
 const rows:Cell[][]=[];const sourceRows:number[]=[];const seen=new Set<string>();
 for(const r of sheet.rows.filter(x=>x.row>header.row)){
  if(used.every(({v,i})=>normalize(v)===normalize(r.values[i]))){repeated++;continue;}
  const row=used.map(({i},j)=>{const v=r.values[i]??null;
   if(parseNumber(v)!==null){const unit=detectCurrency(String(v??'')+' '+headers[j],r.formats[i]||'',true);if(unit!=='UNSPECIFIED')currencyEvidence[headers[j]]=[...new Set([...(currencyEvidence[headers[j]]||[]),unit])];}
if(typeof v!=='string')return v;const clean=v.replace(/[\u00a0\u202f]/g,' ').replace(/\s+/g,' ').trim();if(clean!==v)trimmed++;if(numericIndexes.has(i)){const n=parseNumber(clean);if(n!==null){converted++;return n;}}return clean||null;});
  if(row.every(v=>v===null))continue;const key=JSON.stringify(row);if(seen.has(key))report.duplicateRows++;seen.add(key);rows.push(row);sourceRows.push(r.row);
 }
 if(!rows.length)return null;
 if(trimmed)report.changes.push(`Standardized whitespace in ${trimmed} text values.`);if(converted)report.changes.push(`Parsed ${converted} numeric strings, including currency and decimal-comma formats.`);if(repeated)report.changes.push(`Removed ${repeated} repeated header rows.`);if([...counts.values()].some(c=>c>1))report.changes.push('Added suffixes to duplicate headers; no columns were discarded.');
 if(report.duplicateRows)report.issues.push({severity:'warning',message:`${report.duplicateRows} exact duplicate rows detected. They are kept unless you explicitly choose to remove duplicates.`});
 if(Object.values(currencyEvidence).some(v=>v.length>1))report.issues.push({severity:'warning',message:'Mixed currencies were detected inside amount cells. These values must not be combined into one total.'});
 const mapping=inferMapping(headers);if(!mapping.date||!mapping.revenue)report.issues.push({severity:'warning',message:'Date and amount columns could not both be identified. Choose them before creating a sales dashboard.'});
 report.issues.push({severity:'info',message:'Confirm number conventions: a single comma followed by three digits is interpreted as a thousands separator.'});
 return finish({name,headers,rows,sheet:sheet.name.trim(),kind:'table',report,currencyEvidence,provenance:{sheet:sheet.name,rows:sourceRows,columns:used.map(x=>x.i)}});
}
export function cleanSheets(sheets:RawSheet[],name:string):Dataset[]{
 const datasets:Dataset[]=[];const skipped:string[]=[];
 for(const sheet of sheets){if(!sheet.rows.length){skipped.push(sheet.name);continue;}const cash=ledger(sheet,name);if(cash){datasets.push(cash);continue;}const matrix=matrices(sheet,name);if(matrix.length){datasets.push(...matrix);continue;}const flat=table(sheet,name);if(flat)datasets.push(flat);else skipped.push(sheet.name);}
 datasets.sort((a,b)=>{const score=(d:Dataset)=>/recap/i.test(d.sheet||'')?100:/consolide/.test(normalize(d.sheet))?95:d.report?.layout==='ledger'?80:d.kind==='financial'?60:40;return score(b)-score(a);});
 const ledgerYears=new Set(datasets.filter(d=>d.report?.layout==='ledger').flatMap(d=>d.rows.map(r=>String(r[0]).slice(0,4))));
 for(const d of datasets){if(d.report?.layout==='matrix'&&ledgerYears.size&&d.rows.length&&!d.rows.some(r=>ledgerYears.has(String(r[0]).slice(0,4))))d.report.issues.push({severity:'warning',message:`Date headers use ${[...new Set(d.rows.map(r=>String(r[0]).slice(0,4)))].join(', ')}, while this workbook’s cash books use ${[...ledgerYears].join(', ')}. Source dates are preserved; reconcile the years before comparison.`});d.report!.issues.push({severity:'info',message:'Each source table is analyzed separately. Repeated summaries across sheets are not merged automatically.'});if(skipped.length)d.report!.issues.push({severity:'warning',message:`No supported table detected on: ${skipped.join(', ')}. Those sheets were not silently merged into the analysis.`});}
 if(!datasets.length)throw new Error('No supported table was detected. Put labels above a data table, or use clearly labeled month/year columns.');
 return datasets;
}
