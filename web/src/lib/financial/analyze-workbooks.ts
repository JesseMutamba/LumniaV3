import type {Dataset} from '../analytics/analytics';
import type {RawSheet,FinancialMetric} from '../analytics/import-types';
import type {Figure,Ref,Review,PlanYear,Issue,MonthlyPoint,Q1Metric,Category} from './types';
export type InspectedWorkbook={name:string;sourceHash:string;datasets:Dataset[];sheets:RawSheet[]};
const norm=(v:unknown)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const names={revenue:/^(revenues? bruts?|revenus? bruts?|revenue|total revenue|sales revenue|chiffre d affaires)$/,opex:/^(sous total opex|total opex|total depenses opex|operating expenses|opex)(?: (?:dgo|opex))?$/,capex:/^(sous total capex|total capex|capital expenditure|capex)(\b|$)/,ffb:/^(production ffb|ffb production|ffb produits?|ffb produit plantation)$/,cpo:/^(production cpo|cpo production|po produite|cpo produits?)$/,hectares:/^(hectares a planter|hectares|planting ha)$/,balance:/^(balance|solde|net balance)$/};
const metrics=(d:Dataset)=>d.financial?.metrics||[];
const find=(d:Dataset,p:RegExp)=>{const found=metrics(d).filter(m=>p.test(norm(m.label)));return found.length===1?found[0]:undefined;};
/** Content evidence only: filenames and demo hashes never choose an analysis. */
export function financialWorkbookRoles(book:InspectedWorkbook){
 return {
  plan:book.datasets.some(d=>d.financial?.granularity==='annual'&&!!find(d,names.ffb)&&!!find(d,names.cpo)&&['revenue','opex','capex'].filter(k=>!!find(d,names[k as keyof typeof names])).length>=2),
  actual:book.datasets.some(d=>d.financial?.granularity==='monthly'&&!!find(d,/^(total site|total opex|total operating costs|operating expenses)$/)&&!!find(d,names.ffb)&&!!find(d,names.cpo))
 };
}
const num=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
function coordinates(cell:string){const m=cell.replace(/\$/g,'').match(/^([A-Z]+)([1-9][0-9]*)$/i);if(!m)return null;return {row:Number(m[2]),col:[...m[1].toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1}}
function source(book:InspectedWorkbook,address:unknown):Ref[]{const text=String(address||''),at=text.lastIndexOf('!');if(at<0)return [];const sheet=text.slice(0,at),cell=text.slice(at+1),pos=coordinates(cell),raw=book.sheets.find(s=>norm(s.name)===norm(sheet));return [{file:book.name,sheet,cell,formula:pos?raw?.rows.find(r=>r.row===pos.row)?.formulas[pos.col]||null:null}]}
function values(d:Dataset,m:FinancialMetric|undefined){return m?d.rows.filter(r=>r[1]===m.id&&num(r[2])&&r[6]!=='Unconfirmed template period'):[]}
function figure(book:InspectedWorkbook,d:Dataset,m:FinancialMetric|undefined,year:number,unit:string):Figure{const rows=values(d,m).filter(r=>String(r[0])===String(year));return {value:rows.length===1?Number(rows[0][2]):null,unit,refs:rows.flatMap(r=>source(book,r[7])),...(rows.length>1?{note:'Multiple observations for one year require review.'}:{})}}
function months(book:InspectedWorkbook,d:Dataset,m:FinancialMetric|undefined,year?:number,unit='UNSPECIFIED'):MonthlyPoint[]{return values(d,m).filter(r=>/^\d{4}-\d{2}$/.test(String(r[0]))&&(year===undefined||String(r[0]).startsWith(String(year)))).map(r=>({month:Number(String(r[0]).slice(5,7)),year:Number(String(r[0]).slice(0,4)),label:new Date(String(r[0])+'-01T00:00:00Z').toLocaleString('en-US',{month:'short',timeZone:'UTC'}),value:Number(r[2]),refs:source(book,r[7]),unit})).sort((a,b)=>a.year-b.year||a.month-b.month)}
function currencyCodes(d:Dataset,m:FinancialMetric|undefined){return [...new Set([m?.currency,...values(d,m).map(r=>r[4])].map(v=>String(v||'UNSPECIFIED')).filter(v=>v!=='UNSPECIFIED'&&v!==''))]}
function assertSeries(points:MonthlyPoint[],label:string){if(new Set(points.map(p=>p.year+'-'+p.month)).size!==points.length)throw new Error(label+': duplicate month observations require review before analysis.');}
function productionEvidence(book:InspectedWorkbook){
 const labels=book.sheets.flatMap(s=>s.rows.flatMap(r=>r.values.flatMap((v,c)=>typeof v==='string'&&/tonne|\btonnes?\b/i.test(v)?[{file:book.name,sheet:s.name,cell:colName(c)+r.row}]:[])));
 const conflict=book.datasets.some(d=>metrics(d).some(m=>/ffb|cpo|po produ/i.test(m.label)&&/\b(kg|kilograms?|litres?|liters?)\b/i.test(m.label)));
 if(conflict||!labels.length)throw new Error('Production units need review: this profile requires tonne evidence and cannot convert kilograms or litres automatically.');
 return labels;
}
function total(points:MonthlyPoint[],unit:string):Figure{return {value:points.length?points.reduce((s,p)=>s+p.value,0):null,unit,refs:points.flatMap(p=>p.refs)}}
function equals(a:number,b:number){return Math.abs(a-b)<=Math.max(.02,Math.abs(b)*.000001)}
function disjointCategories(book:InspectedWorkbook,d:Dataset,totalMetric:FinancialMetric|undefined,year:number):Category[]{
 const row=values(d,totalMetric).find(r=>String(r[0])===String(year));if(!row)return [];
 const ref=source(book,row[7])[0],formula=ref?.formula||'',range=formula.match(/^=?SUM\(\$?([A-Z]+)\$?(\d+):\$?\1\$?(\d+)\)$/i);if(!range)return [];
 const candidates=d.rows.filter(r=>String(r[0])===String(year)&&num(r[2])&&source(book,r[7]).some(s=>{const pos=coordinates(s.cell);return s.sheet===ref.sheet&&pos&&s.cell.replace(/[0-9]/g,'')===range[1]&&pos.row>=Number(range[2])&&pos.row<=Number(range[3])}));
 const result=candidates.map(r=>({name:String(r[1]),value:Number(r[2]),refs:source(book,r[7])}));return equals(result.reduce((s,c)=>s+c.value,0),Number(row[2]))?result:[];
}
function monthlyBinding(book:InspectedWorkbook,kind:'opex'|'ffb'|'cpo',year:number,annual:number|null,issues:Issue[]){
 const candidates=book.datasets.filter(d=>d.financial?.granularity==='monthly').flatMap(d=>metrics(d).filter(m=>kind==='opex'?names.opex.test(norm(m.label)):kind==='ffb'?/^(bu \d{2}|budget|ffb|production ffb)/.test(norm(m.label))&&!/jour|day|oer/.test(norm(m.label)):/^(cpo|production cpo|tonne cpo)/.test(norm(m.label))&&!/jour|day|ha/.test(norm(m.label))).map(m=>({d,m,points:months(book,d,m,year,kind==='opex'?'USD':'t')}))).filter(c=>c.points.length===12&&new Set(c.points.map(p=>p.month)).size===12&&annual!==null&&(kind!=='opex'||currencyCodes(c.d,c.m).every(code=>code==='USD'))&&equals(c.points.reduce((s,p)=>s+p.value,0),annual));
 if(!candidates.length){issues.push({id:'missing-monthly-'+kind,severity:'warning',title:'Monthly '+kind.toUpperCase()+' budget not reconciled',detail:'No complete monthly schedule matches the selected annual total. Quarter totals are not estimated by dividing the annual plan by four.',refs:[]});return null}
 const unique=new Map<string,typeof candidates[0]>();for(const c of candidates){const key=JSON.stringify(c.points.map(p=>p.value));if(!unique.has(key))unique.set(key,c)}
 if(unique.size>1){issues.push({id:'ambiguous-monthly-'+kind,severity:'warning',title:'Conflicting monthly '+kind.toUpperCase()+' schedules',detail:'Several schedules reconcile annually but differ by month. A single eligible total is selected by its explicit grand-total label; review the source schedule before relying on the comparison.',refs:candidates.flatMap(c=>c.points.slice(0,3).flatMap(p=>p.refs))})}
 const priority=(c:typeof candidates[0])=>Number(/total depenses opex/.test(norm(c.m.label)))*10+Number(c.points.some(p=>p.refs.some(r=>/^[=+]*[A-Z]+[0-9]+\+[A-Z]+[0-9]+$/i.test(r.formula||''))));
 candidates.sort((a,b)=>priority(b)-priority(a));
 if(unique.size>1&&candidates.filter(c=>priority(c)===priority(candidates[0])).some(c=>JSON.stringify(c.points.map(p=>p.value))!==JSON.stringify(candidates[0].points.map(p=>p.value))))return null;
 const picked=candidates[0];
 if(kind==='opex')for(const d of book.datasets.filter(d=>d.financial?.granularity==='monthly')){
  const groups=metrics(d).filter(m=>/^sous total\b/.test(norm(m.label))).map(m=>months(book,d,m,year,'USD')).filter(p=>p.length===12&&new Set(p.map(v=>v.month)).size===12);
  if(groups.length<2)continue;
  const grouped=Array.from({length:12},(_,i)=>groups.reduce((n,g)=>n+(g.find(p=>p.month===i+1)?.value||0),0));
  if(annual!==null&&equals(grouped.reduce((n,v)=>n+v,0),annual)&&grouped.some((v,i)=>!equals(v,picked.points[i].value))){const delta=grouped.slice(0,3).reduce((n,v)=>n+v,0)-picked.points.slice(0,3).reduce((n,p)=>n+p.value,0);issues.push({id:'alternative-opex-'+d.sheet,severity:'warning',title:'Two OPEX schedules have different monthly timing',detail:`The subtotal groups in ${d.sheet} reconcile to annual OPEX but their Q1 total differs by $${delta.toLocaleString('en-US',{maximumFractionDigits:2})} from the selected explicit grand total. The consolidated grand total is used; confirm the intended budget version.`,refs:groups.flatMap(g=>g.slice(0,3).flatMap(p=>p.refs))})}
 }
 return picked;
}
export function analyzeWorkbooks(planBook:InspectedWorkbook,actualBook?:InspectedWorkbook,title='Client financial review'):Review{
 const issues:Issue[]=[],bindings:Review['bindings']=[];
 if(actualBook&&actualBook.name===planBook.name)throw new Error('Use distinct filenames for the plan and actuals so every source reference is unambiguous.');
 const annualCandidates=planBook.datasets.filter(d=>d.financial?.granularity==='annual').map(d=>({d,score:Object.values(names).reduce((n,p)=>n+Number(!!find(d,p)),0)})).filter(c=>c.score>=5).sort((a,b)=>b.score-a.score);
 if(!annualCandidates.length)throw new Error('The plan needs a recognizable annual summary with revenue, OPEX, CAPEX, FFB and CPO production. Review the detected tables in Analytics Studio first.');
 const annual=annualCandidates[0].d;
 if(annualCandidates[1]?.score===annualCandidates[0].score)throw new Error('More than one annual summary fits this plan. Keep the intended summary in the upload or select it in Analytics Studio.');
 const matched=Object.fromEntries(Object.entries(names).map(([key,p])=>[key,find(annual,p)])) as Record<keyof typeof names,FinancialMetric|undefined>;
 if(!matched.opex||!matched.cpo||!matched.ffb||!matched.revenue||!matched.capex)throw new Error('The annual plan is missing a required cost, production or revenue definition.');
 const moneyCodes=[matched.opex,matched.capex,matched.revenue].map(m=>currencyCodes(annual,m));if(moneyCodes.some(codes=>!codes.includes('USD')||codes.some(c=>c!=='USD')))throw new Error('This palm-oil forecast profile requires explicitly identified USD plan amounts. It does not convert currencies.');
 const unitEvidence=productionEvidence(planBook);issues.push({id:'production-unit-evidence',severity:'info',title:'Production is interpreted in tonnes',detail:'This palm-oil profile uses the source tonne labels, cost-per-tonne denominator and matching production totals to interpret FFB and CPO in tonnes. Confirm this unit convention for a new client.',refs:unitEvidence.slice(0,12)});
 const years=[...new Set(annual.rows.map(r=>Number(r[0])).filter(y=>y>=1900&&y<=2300))].sort((a,b)=>a-b);
 const plan:PlanYear[]=years.map(year=>({year,...Object.fromEntries(Object.entries(matched).map(([key,m])=>[key,figure(planBook,annual,m,year,['ffb','cpo'].includes(key)?'t':key==='hectares'?'ha':'USD')]))} as PlanYear));
 const forecastYears=plan.filter(p=>[p.revenue,p.opex,p.capex,p.ffb,p.cpo].every(v=>v.value!==null)&&['revenue','opex','capex','ffb','cpo'].every(key=>values(annual,matched[key as keyof typeof names]).some(r=>String(r[0])===String(p.year)&&/projection|plan/i.test(String(r[6]))))).map(p=>p.year);if(!forecastYears.length)throw new Error('No complete forecast year was found. Missing cells remain unavailable, never zero.');
 for(const p of plan.filter(p=>forecastYears.includes(p.year)))if(p.ffb.value!<=0||p.cpo.value!<=0||p.cpo.value!/p.ffb.value!<.01||p.cpo.value!/p.ffb.value!>.45||p.opex.value!<0||p.capex.value!<0||p.revenue.value!<0)throw new Error('The forecast profile requires positive production, extraction between 1% and 45%, and nonnegative revenue and expenditure. Review the source totals.');
 const comparisonYear=forecastYears[0],base=plan.find(p=>p.year===comparisonYear)!;
 for(const [role,m] of Object.entries(matched))if(m)bindings.push({role:'Annual '+role,table:annual.sheet||'',metric:m.id,unit:['ffb','cpo'].includes(role)?'t':role==='hectares'?'ha':m.currency});
 const monthly={opex:monthlyBinding(planBook,'opex',comparisonYear,base.opex.value,issues),ffb:monthlyBinding(planBook,'ffb',comparisonYear,base.ffb.value,issues),cpo:monthlyBinding(planBook,'cpo',comparisonYear,base.cpo.value,issues)};
 for(const [role,c] of Object.entries(monthly))if(c)bindings.push({role:'Monthly budget '+role,table:c.d.sheet||'',metric:c.m.id,unit:role==='opex'?'USD':'t'});
 const q1:Q1Metric[]=[],actualCosts:Category[]=[];
 const books=[planBook];
 collectWorkbookIssues(books,issues);
 const planCosts=disjointCategories(planBook,annual,matched.opex,comparisonYear);
 const development=planBook.sheets.flatMap(s=>s.rows.filter(r=>r.values.some(v=>/^(developpement plantations?|total capital expenditure)$/i.test(String(v||'').trim()))).map(r=>({s,r}))).filter(({s,r})=>/opex|salair/i.test(s.name));
 if(development.length)issues.push({id:'development-classification',severity:'warning',title:'Development costs appear within the OPEX schedules',detail:'The source includes development payroll in operating schedules. Reported OPEX per tonne is shown without reclassifying it. A pure production-cost definition requires client review.',refs:development.map(({s,r})=>({file:planBook.name,sheet:s.name,cell:colName(r.values.findIndex(v=>/^(developpement plantations?|total capital expenditure)$/i.test(String(v||'').trim())))+r.row}))});
 for(const sheet of planBook.sheets){
 const capacity=sheet.rows.find(r=>r.values.some(v=>/^(capacite usine|mill capacity)\b/.test(norm(v))));
 const fruit=sheet.rows.find(r=>r.values.some(v=>names.ffb.test(norm(v))));if(!capacity||!fruit)continue;
 const headers=sheet.rows.filter(r=>r.row<fruit.row&&r.values.some(v=>num(v)&&forecastYears.includes(v))).sort((a,b)=>b.values.filter(v=>num(v)&&forecastYears.includes(v)).length-a.values.filter(v=>num(v)&&forecastYears.includes(v)).length||b.row-a.row);if(!headers.length)continue;
 const breaches=plan.filter(p=>forecastYears.includes(p.year)).flatMap(p=>{
  const matches=fruit.values.flatMap((v,col)=>num(v)&&p.ffb.value!==null&&equals(v,p.ffb.value)&&num(capacity.values[col])&&Number(capacity.values[col])>0?[col]:[]);
  return matches.flatMap(col=>{const header=headers[0],year=header.values.slice(0,col+1).filter(v=>num(v)&&v>=1900&&v<=2300).at(-1);const cap=Number(capacity.values[col]);return year===p.year&&p.ffb.value!>cap?[{year:p.year,utilization:p.ffb.value!/cap,cap,refs:[{file:planBook.name,sheet:sheet.name,cell:colName(col)+capacity.row,formula:capacity.formulas[col]||null},...p.ffb.refs]}]:[]});
 });
 if(breaches.length)issues.push({id:'mill-capacity-'+sheet.name,severity:'warning',title:'Planned fruit exceeds the stated mill capacity',detail:breaches.map(b=>`${b.year}: ${(b.utilization*100).toFixed(1)}% of ${b.cap.toLocaleString('en-US',{maximumFractionDigits:1})} tonnes FFB annual capacity`).join('; ')+'. Confirm capacity expansion or outsourced processing before relying on the production ramp. Forecast and Monte Carlo do not cap production to mill throughput.',refs:breaches.flatMap(b=>b.refs)});
 }
 const complete=plan.filter(p=>forecastYears.includes(p.year)),rates=complete.map(p=>p.opex.value!/p.cpo.value!);if(rates.length>2&&rates.every(r=>equals(r,rates[0])))issues.push({id:'constant-unit-cost',severity:'info',title:'Constant future unit cost is built into the plan',detail:'The annual plan keeps OPEX per tonne unchanged as volume grows. This is a workbook modeling assumption, not evidence that future efficiency has been achieved.',refs:complete.flatMap(p=>[...p.opex.refs,...p.cpo.refs])});
 const review:Review={version:1,title,createdAt:new Date().toISOString(),plan,forecastYears,comparisonYear,q1,monthlyPlan:{opex:monthly.opex?.points||[],ffb:monthly.ffb?.points||[],cpo:monthly.cpo?.points||[]},planCosts,actualCosts,issues,sources:books.map(workbookInfo),bindings,steps:[{name:'Prepare sources',detail:'Detect populated tables, preserve original cells and cached formula values, and expose missing/error cells.'},{name:'Recognize financial measures',detail:'Match normalized labels for revenue, OPEX, CAPEX, FFB and CPO. Require a complete annual USD summary.'},{name:'Reconcile monthly budgets',detail:'Match each complete monthly schedule to the corresponding annual total. Never add duplicate site/summary schedules together.'},{name:'Align the reporting quarter',detail:'Compare common observed Q1 months. Keep conflicting source years visible and mark comparisons provisional.'},{name:'Calculate unit economics',detail:'Compute cost per tonne as the sum of matching costs divided by the sum of matching production. Never average monthly unit costs.'},{name:'Model scenarios and uncertainty',detail:'Use editable plan-based drivers. Monte Carlo uncertainty comes from disclosed user-set assumptions, not fitting future plan years as historical data.'}]};
 return actualBook?addOperatingResults(review,actualBook):review;
}
function workbookInfo(b:InspectedWorkbook):Review['sources'][number]{return {name:b.name,hash:b.sourceHash,sheets:b.sheets.length,tables:b.datasets.length,formulaErrors:b.sheets.reduce((s,t)=>s+t.formulaErrors,0),missingFormulaResults:b.sheets.reduce((s,t)=>s+t.missingFormulaResults,0)}}
function collectWorkbookIssues(books:InspectedWorkbook[],issues:Issue[]){
 for(const book of books){const errors=book.sheets.reduce((s,t)=>s+t.formulaErrors,0),missing=book.sheets.reduce((s,t)=>s+t.missingFormulaResults,0);if(errors||missing)issues.push({id:'formulas-'+book.sourceHash,severity:'warning',title:'Source formula results need review',detail:`${book.name}: ${errors} error cells and ${missing} missing cached formula results. Cached source values are preserved; formulas are not silently repaired.`,refs:book.sheets.flatMap(s=>s.issues.filter(i=>i.source).flatMap(i=>source(book,i.source))).slice(0,20)});
  const external=book.sheets.flatMap(s=>s.rows.flatMap(r=>r.formulas.flatMap((f,c)=>f&&/\[[^\]]+\]/.test(f)?[{file:book.name,sheet:s.name,cell:colName(c)+(r.row),formula:f}]:[])));if(external.length)issues.push({id:'external-'+book.sourceHash,severity:'warning',title:'Workbook depends on external links',detail:`${external.length} formulas reference another workbook. Cached values can be inspected, but those external files were not supplied for recalculation.`,refs:external.slice(0,12)});
 }
}
/** Add or replace observed results using the saved, reconciled plan. Raw plan cells are not reconstructed. */
export function addOperatingResults(review:Review,actualBook:InspectedWorkbook):Review{
 const planSource=review.sources[0];
 if(!planSource||!review.plan.some(p=>p.year===review.comparisonYear))throw new Error('Open a financial plan before adding operating results.');
 if(actualBook.name===planSource.name)throw new Error('Use distinct filenames for the plan and actuals so every source reference is unambiguous.');
 if(actualBook.sourceHash===planSource.hash)throw new Error('Select a different workbook for operating results. This file has the same contents as the retained plan.');
 const actualCandidates=actualBook.datasets.filter(d=>d.financial?.granularity==='monthly'&&find(d,/^(total site|total opex|total operating costs|operating expenses)$/)&&find(d,names.ffb)&&find(d,names.cpo));
 if(actualCandidates.length!==1)throw new Error('The results workbook needs one recognizable monthly table with total operating costs, FFB and CPO production. Review the detected tables in Analytics Studio first.');
 const unitEvidence=productionEvidence(actualBook);
 const next=structuredClone(review),{comparisonYear,monthlyPlan}=next,base=next.plan.find(p=>p.year===comparisonYear)!;
 const actualIssueIds=new Set(['actual-map','actual-currency','period-conflict','cost-scope','actual-revenue','missing-q1-opex','missing-q1-ffb','missing-q1-cpo']);
 const oldActualSources=next.sources.slice(1);
 for(const old of oldActualSources)if(old.hash!==planSource.hash){actualIssueIds.add('formulas-'+old.hash);actualIssueIds.add('external-'+old.hash)}
 next.issues=next.issues.filter(issue=>!actualIssueIds.has(issue.id));
 const unitIssue=next.issues.find(issue=>issue.id==='production-unit-evidence');
 if(unitIssue)unitIssue.refs=[...unitIssue.refs.filter(ref=>ref.file===planSource.name),...unitEvidence].slice(0,12);
 next.bindings=next.bindings.filter(binding=>!binding.role.startsWith('Q1 actual '));
 next.sources=[next.sources[0],workbookInfo(actualBook)];
 next.q1=[];next.actualCosts=[];
 const {issues,bindings,q1,actualCosts}=next;
 const actual=actualCandidates[0],am={opex:find(actual,/^(total site|total opex|total operating costs|operating expenses)$/),ffb:find(actual,names.ffb),cpo:find(actual,names.cpo)};
 const cm=find(actual,/^(cout tonne usd|cost tonne usd|cost per tonne usd)$/),cost=months(actualBook,actual,cm);
 const actualValues={opex:months(actualBook,actual,am.opex),ffb:months(actualBook,actual,am.ffb),cpo:months(actualBook,actual,am.cpo)};
 for(const [id,points] of Object.entries(actualValues)){assertSeries(points,'Actual '+id);if(new Set(points.map(p=>p.year)).size!==1)throw new Error('Each actual metric must use one reporting year. Review '+id+' dates.')}assertSeries(cost,'Actual cost per tonne');
 const actualYears=[...new Set(Object.values(actualValues).flatMap(v=>v.map(p=>p.year)))];
 const codes=currencyCodes(actual,am.opex),explicitConflict=codes.some(c=>c!=='USD');
 const unitProven=!explicitConflict&&(codes.includes('USD')||(cost.length>0&&currencyCodes(actual,cm).every(c=>c==='USD')&&cost.every(c=>{const a=actualValues.opex.find(p=>p.month===c.month&&p.year===c.year),v=actualValues.cpo.find(p=>p.month===c.month&&p.year===c.year);return a&&v&&v.value>0&&equals(c.value*v.value,a.value)})));
 if(!unitProven)issues.push({id:'actual-currency',severity:'warning',title:'Actual cost currency is unverified',detail:'No USD source label or cost-per-tonne identity confirms the cost unit. Review before comparison.',refs:actualValues.opex.flatMap(p=>p.refs)});
 const dateConflict=actualYears.length!==1||actualYears[0]!==comparisonYear;
 if(dateConflict)issues.push({id:'period-conflict',severity:'warning',title:'Source dates do not match the plan year',detail:`The actual series contain source year(s) ${actualYears.join(', ')}, while the selected plan is ${comparisonYear}. Q1 is compared by month as a provisional comparison; no source-year correction is assumed. Source dates are preserved.`,refs:actualValues.opex.flatMap(p=>p.refs)});
 issues.push({id:'cost-scope',severity:'warning',title:'Confirm the scope of operating costs',detail:'The comparison uses the plan’s workbook-defined total OPEX and the actual table’s reported site costs. Development and headquarters costs may be classified differently. The variance alone does not establish production efficiency.',refs:[...base.opex.refs,...actualValues.opex.flatMap(p=>p.refs)]});
 const allSeries=[...Object.values(actualValues),...Object.values(monthlyPlan)];const quarterMonths=[1,2,3].filter(m=>allSeries.every(series=>series.some(p=>p.month===m)));
 for(const id of ['opex','ffb','cpo'] as const){const a=actualValues[id].filter(p=>p.month<=3),p=monthlyPlan[id].filter(p=>p.month<=3),common=new Set(quarterMonths),selectedActual=a.filter(p=>common.has(p.month)),selectedPlan=p.filter(p=>common.has(p.month)),unit=id==='opex'?(unitProven?'USD':'UNVERIFIED'):'t';
  q1.push({id,label:{opex:'Reported OPEX',ffb:'FFB production',cpo:'CPO production'}[id],unit,plan:total(selectedPlan,unit),actual:total(selectedActual,unit),planMonths:selectedPlan,actualMonths:selectedActual,status:common.size===0?'unavailable':dateConflict||id==='opex'||common.size<3?'review':'aligned'});
  bindings.push({role:'Q1 actual '+id,table:actual.sheet||'',metric:am[id]?.id||'',unit});
  if(common.size<3)issues.push({id:'missing-q1-'+id,severity:'warning',title:'Incomplete Q1 '+id.toUpperCase(),detail:'Both sides use only common observed months. Missing months are not treated as zero.',refs:[...selectedActual.flatMap(p=>p.refs),...selectedPlan.flatMap(p=>p.refs)]});
 }
 const totals=metrics(actual).filter(m=>/^(total plantations|total usine|total autres services)$/.test(norm(m.label))).map(m=>{const p=months(actualBook,actual,m).filter(p=>p.month<=3);return {name:m.label,value:p.reduce((s,p)=>s+p.value,0),refs:p.flatMap(p=>p.refs)}});
 const actualOpex=q1.find(q=>q.id==='opex')?.actual.value;
 if(actualOpex!==null&&actualOpex!==undefined&&equals(totals.reduce((s,c)=>s+c.value,0),actualOpex))actualCosts.push(...totals);
 if(!find(actual,/^(revenue|revenus|sales revenue|chiffre d affaires)$/))issues.push({id:'actual-revenue',severity:'info',title:'Actual sales revenue is unavailable',detail:'The cost/production table does not identify verified sales revenue. Cash receipts are not assumed to be sales, and production is not assumed to have been sold.',refs:[]});
 collectWorkbookIssues([actualBook],issues);
 return next;
}

function colName(index:number){let text='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text;return text}
