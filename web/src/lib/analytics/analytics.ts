import { parseNumber } from './numbers';
import { columnName } from './provenance';
import type { ImportReport, FinancialProfile } from './import-types';
export type Cell = string | number | null;
export type Dataset = { id?: string; name: string; headers: string[]; rows: Cell[][]; sheet?: string; sample?: boolean; kind?: 'financial' | 'table'; report?: ImportReport; financial?: FinancialProfile; sourceHash?: string; currencyEvidence?:Record<string,string[]>; provenance?: { sheet:string; rows:number[]; columns:number[] } };
export type Mapping = { date: string; revenue: string; region: string; product: string; currency: string; dateFormat: 'MDY' | 'DMY'; metric?: string; removeDuplicates?: boolean };
export type View = 'monthly' | 'quarterly' | 'yearly' | 'region' | 'product';
export type Message = { role: 'user' | 'assistant'; text: string };
export type StudioState = { mapping: Mapping; views: View[]; messages: Message[] };
export type Point = { name: string; revenue: number; count: number; key: string; sources:string[] };
export const viewLabels: Record<View,string> = { monthly:'Monthly revenue', quarterly:'Quarterly revenue', yearly:'Yearly revenue', region:'Revenue by region', product:'Revenue by product' };
export function inferMapping(headers: string[]): Mapping {
 const find=(pattern:RegExp)=>headers.find(h=>pattern.test(h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[_-]/g,' ').replace(/\s*\(?\b(?:usd|cdf|eur|gbp|cad|aud|xof|xaf)\b\)?\s*/g,' ').trim()))||'';
 const currency = headers.find(h => /revenu|sales|amount|montant/i.test(h))?.toUpperCase().match(/\b(USD|CDF|EUR|GBP|CAD|AUD|XOF|XAF)\b/)?.[1] || 'UNSPECIFIED';
 return {date:find(/^(order date|sale date|date|transaction date|invoice date|month|dates|periode|period|mois|annee|year)$/),revenue:find(/^(revenue|sales total|total sales|sales|net sales|net revenue|amount|total|total revenue|revenu|revenus|recette|recettes|chiffre d'affaires|montant|amount)$/),region:find(/^(region|territory|area|market|site|division|pays)$/),product:find(/^(product|product name|category|produit|categorie)$/),currency,dateFormat:'MDY'};
}
export const parseRevenue = parseNumber;
export function parseDate(value:Cell,format:'MDY'|'DMY'='MDY'):string|null {
 if(value==null||value==='')return null;
 if(typeof value==='number'){if(value<1||value>200000)return null;return new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);}
 const s=value.trim();if(/^\d{4}$/.test(s))return Number(s)>=1900&&Number(s)<=2300?s+'-01-01':null;let y:number,m:number,d:number;
 const iso=s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?(?:[T ].*)?$/),slash=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
 if(iso){y=+iso[1];m=+iso[2];d=+(iso[3]||1);}else if(slash){y=+slash[3];m=+(format==='MDY'?slash[1]:slash[2]);d=+(format==='MDY'?slash[2]:slash[1]);}else return null;
 const date=new Date(Date.UTC(y,m-1,d));if(y<1900||y>2300||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)return null;return date.toISOString().slice(0,10);
}
export function analyze(dataset:Dataset,mapping:Mapping){
 const di=dataset.headers.indexOf(mapping.date),ri=dataset.headers.indexOf(mapping.revenue),gi=dataset.headers.indexOf(mapping.region),pi=dataset.headers.indexOf(mapping.product);
 let invalidRevenue=0,invalidDate=0,duplicatesRemoved=0;
 const seen=new Set<string>();
 const rows=dataset.rows.flatMap((row,index)=>{
  const key=JSON.stringify(row);if(mapping.removeDuplicates&&seen.has(key)){duplicatesRemoved++;return [];}seen.add(key);
  const revenue=parseRevenue(row[ri]),date=parseDate(/^(year|annee)$/i.test(mapping.date.normalize('NFD').replace(/[\u0300-\u036f]/g,''))&&typeof row[di]==='number'?String(row[di]):row[di],mapping.dateFormat);
  if(revenue===null)invalidRevenue++;if(!date)invalidDate++;
  const origin=dataset.provenance,source=origin?`${origin.sheet}!${columnName(origin.columns[ri])}${origin.rows[index]}`:'';
  return revenue===null||!date?[]:[{revenue,date,region:String(row[gi]??'').trim()||'Unspecified',product:String(row[pi]??'').trim()||'Unspecified',source}];
 });
 const groups=(view:View):Point[]=>{
  const map=new Map<string,Point>();
  for(const row of rows){
   const month=+row.date.slice(5,7),year=row.date.slice(0,4);
   const key=view==='monthly'?row.date.slice(0,7):view==='quarterly'?`${year}-Q${Math.ceil(month/3)}`:view==='yearly'?year:row[view];
   const name=view==='monthly'?new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-US',{month:'short',year:'2-digit',timeZone:'UTC'}):key;
   const point=map.get(key)||{key,name,revenue:0,count:0,sources:[]};
   point.revenue+=row.revenue;point.count++;if(row.source)point.sources.push(row.source);map.set(key,point);
  }
  return [...map.values()].map(p=>({...p,revenue:Math.round(p.revenue*100)/100})).sort((a,b)=>view==='region'||view==='product'?b.revenue-a.revenue:a.key.localeCompare(b.key));
 };
 const total=Math.round(rows.reduce((s,r)=>s+r.revenue,0)*100)/100,dates=rows.map(r=>r.date).sort();
 return {rows,total,count:rows.length,average:rows.length?total/rows.length:0,excluded:dataset.rows.length-rows.length,invalidRevenue,invalidDate,duplicatesRemoved,groups,start:dates[0],end:dates.at(-1)};
}
export function interpretRequest(prompt:string,views:View[],mapping:Mapping):{views:View[];reply:string;changed:boolean}{
 const p=prompt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/mensuel(?:le)?s?|mois/g,'monthly').replace(/trimestriel(?:le)?s?|trimestres?/g,'quarterly').replace(/annuel(?:le)?s?|annees?/g,'yearly').replace(/regions?/g,'region').replace(/produits?|categories?/g,'product').replace(/supprimer|retirer|masquer/g,'remove').trim(),requested:View[]=[];
 if(/\b(month|monthly|months)\b/.test(p))requested.push('monthly');if(/\b(quarter|quarterly|quarters)\b/.test(p))requested.push('quarterly');if(/\b(year|yearly|annual|annually|years)\b/.test(p))requested.push('yearly');if(/\b(region|regions|territory|territories)\b/.test(p))requested.push('region');if(/\b(product|products|category|categories)\b/.test(p))requested.push('product');
 if(!requested.length||/\b(forecast|predict|profit|margin|filter|only|excluding|exclude|compare|comparison|percentage)\b/.test(p)||/\b20\d{2}\b/.test(p))return {views,changed:false,reply:'I can add or remove revenue charts by month, quarter, year, region, or product for the full dataset. Try “Show monthly revenue” or “Add revenue by region”. Filters, forecasts, and other metrics aren’t supported yet.'};
 if(requested.includes('region')&&!mapping.region)return {views,changed:false,reply:'Choose a region column in Data → Column mapping first, then ask me again.'};if(requested.includes('product')&&!mapping.product)return {views,changed:false,reply:'Choose a product column in Data → Column mapping first, then ask me again.'};
 const remove=/\b(remove|delete|hide)\b/.test(p),next=remove?views.filter(v=>!requested.includes(v)):[...new Set([...views,...requested])],changed=JSON.stringify(next)!==JSON.stringify(views);
 return {views:next,changed,reply:changed?`${remove?'Removed':'Added'} ${requested.map(v=>viewLabels[v].toLowerCase()).join(' and ')}. ${!remove&&views.length?'Your existing charts are still here.':'Your dashboard is ready.'}`:`${requested.map(v=>viewLabels[v]).join(' and ')} ${remove?'is not on':'is already on'} this dashboard.`};
}
export function parseCSV(text:string):{headers:string[];rows:Cell[][]}{
 text=text.replace(/^\uFEFF/,'');const firstLine=text.split(/\r?\n/)[0]||'',delimiter=firstLine.includes('\t')?'\t':(firstLine.split(';').length>firstLine.split(',').length?';':',');
 const result:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))result.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw new Error('A quoted field is unfinished. Check the CSV file and try again.');row.push(cell);if(row.some(v=>v.trim()))result.push(row);return tableFromRows(result);
}
export function tableFromRows(table:Cell[][]):{headers:string[];rows:Cell[][]}{
 if(table.length<2)throw new Error('Include a header row and at least one data row.');const headers=table[0].map(v=>String(v??'').trim());if(headers.some(h=>!h)||new Set(headers.map(h=>h.toLowerCase())).size!==headers.length)throw new Error('Each column needs a unique, nonempty header.');if(headers.length>100||table.length>20001)throw new Error('Use a spreadsheet with up to 20,000 rows and 100 columns.');
 const rows=table.slice(1).filter(r=>r.some(v=>v!==null&&v!==''));if(rows.some(r=>r.length>headers.length&&r.slice(headers.length).some(v=>v!==null&&v!=='')))throw new Error('Some rows have more columns than the header. Check the spreadsheet.');return {headers,rows:rows.map(r=>headers.map((_,i)=>r[i]??null))};
}
export function sampleDataset():Dataset {
 const rows:Cell[][]=[],monthly=[16240,18920,17480,22100,21340,26450,24690,29300,27410,32160,30620,37640],regions=['North America','Europe','Asia Pacific','Latin America'];
 monthly.forEach((total,m)=>{for(let i=0;i<20;i++){const amount=i===19?Math.round((total-rows.slice(m*20).reduce((s,r)=>s+Number(r[2]),0))*100)/100:Math.round(total*(0.026+((i*7)%11)*0.004)*100)/100;rows.push([`ORD-${1001+m*20+i}`,`2025-${String(m+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`,amount,regions[i%4],['Essentials','Professional','Enterprise'][i%3]]);}});return {name:'Sales_2025.csv',headers:['Order ID','Order Date','Revenue','Region','Product'],rows,sample:true};
}
export const money=(n:number,currency='USD',compact=false)=>new Intl.NumberFormat('en-US',{...(currency==='UNSPECIFIED'?{}:{style:'currency' as const,currency}),minimumFractionDigits:0,maximumFractionDigits:compact?1:2,notation:compact?'compact':'standard'}).format(n);

/** Currency evidence survives numeric cleaning, including symbols and cell formats. */
export function currenciesForMeasure(dataset:Dataset,mapping:Mapping):string[]{
 const index=dataset.headers.findIndex(h=>/^(currency|currency code|devise|code devise|monnaie)$/i.test(h.trim()));
 const fromColumn=index<0?[]:dataset.rows.map(r=>String(r[index]||'').trim().toUpperCase()).filter(Boolean);
 return [...new Set([...(dataset.currencyEvidence?.[mapping.revenue]||[]),...fromColumn])];
}
