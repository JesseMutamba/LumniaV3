import { compactSources } from './provenance';
import { money, type Dataset, type Mapping, type View } from './analytics';
import type { FinancialMetric } from './import-types';
export type FinancePoint={key:string;name:string;value:number;source:string;count:number;sources:string[]};
export function defaultMetric(dataset:Dataset){return dataset.financial?.metrics.find(m=>/revenu|revenue/i.test(m.label))?.id||dataset.financial?.metrics.find(m=>m.role==='payments'&&m.currency==='USD')?.id||dataset.financial?.metrics.find(m=>m.role==='payments')?.id||dataset.financial?.metrics[0]?.id||'';}
export function metricFormat(value:number,metric:FinancialMetric,compact=false){if(metric.unit==='percent')return new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:2}).format(value);return money(value,metric.unit==='currency'?metric.currency:'UNSPECIFIED',compact);}
export function financialAnalysis(dataset:Dataset,id:string){
 const metric=dataset.financial?.metrics.find(m=>m.id===id)||dataset.financial?.metrics[0];if(!metric)return null;
 const rows=dataset.rows.filter(r=>r[1]===metric.id&&typeof r[2]==='number'&&r[6]!=='Unconfirmed template period').map(r=>({period:String(r[0]),value:Number(r[2]),category:String(r[3]),source:String(r[7])})).sort((a,b)=>a.period.localeCompare(b.period));
 const byPeriod=new Map<string,FinancePoint>();
 for(const r of rows){const key=dataset.financial?.granularity==='daily'?r.period.slice(0,7):r.period;const point=byPeriod.get(key)||{key,name:key,value:0,source:r.source,count:0,sources:[]};point.value=metric.aggregation==='last'||metric.unit==='percent'?r.value:point.value+r.value;point.sources=metric.aggregation==='last'||metric.unit==='percent'?[r.source]:[...point.sources,r.source];point.count++;byPeriod.set(key,point);}
 const points=[...byPeriod.values()].map(p=>({...p,source:compactSources(p.sources)})).sort((a,b)=>a.key.localeCompare(b.key));
 const categories=new Map<string,FinancePoint>();for(const r of rows){const p=categories.get(r.category)||{key:r.category,name:r.category,value:0,source:r.source,count:0,sources:[]};p.value+=r.value;p.count++;p.sources.push(r.source);categories.set(r.category,p);}
 const breakdown=metric.aggregation==='sum'&&metric.unit!=='percent'?[...categories.values()].map(p=>({...p,source:compactSources(p.sources)})).sort((a,b)=>b.value-a.value):[];
 const total=metric.aggregation==='last'||metric.unit==='percent'?points.at(-1)?.value||0:points.reduce((s,p)=>s+p.value,0);
 const high=[...points].sort((a,b)=>b.value-a.value)[0],low=[...points].sort((a,b)=>a.value-b.value)[0],latest=points.at(-1),prior=points.at(-2),change=prior&&prior.value>0&&latest?(latest.value-prior.value)/prior.value:null;
 const insights:{title:string;text:string;source:string}[]=[];
 if(high)insights.push({title:'Highest reported period',text:`${high.name} has the highest ${metric.label.toLowerCase()}: ${metricFormat(high.value,metric)}.`,source:high.source});
 if(latest&&prior&&change!==null)insights.push({title:'Change from prior period',text:`${latest.name} is ${Math.abs(change*100).toFixed(1)}% ${change>=0?'higher':'lower'} than ${prior.name}. This describes workbook values; it is not a forecast.`,source:`${prior.source}; ${latest.source}`});
 const negative=points.filter(p=>p.value<0);if(negative.length)insights.push({title:'Negative values',text:`${negative.length} period${negative.length===1?' has':'s have'} a negative value. Lowest: ${low.name} (${metricFormat(low.value,metric)}).`,source:low.source});
 if(breakdown.length>1&&total>0){const top=breakdown[0];insights.push({title:'Largest category',text:`${top.name} contributes ${metricFormat(top.value,metric)}, or ${(top.value/total*100).toFixed(1)}% of this measure.`,source:top.source});}
 if(dataset.report?.layout==='ledger'){
  const opening=dataset.rows.filter(r=>r[1]===`Opening balance · ${metric.currency}`).reduce((s,r)=>s+Number(r[2]),0);
  const receipts=dataset.rows.filter(r=>r[1]===`Cash receipts · ${metric.currency}`).reduce((s,r)=>s+Number(r[2]),0);
  const payments=dataset.rows.filter(r=>r[1]===`Cash payments · ${metric.currency}`).reduce((s,r)=>s+Number(r[2]),0);
  const balances=dataset.rows.filter(r=>r[1]===`Closing balance · ${metric.currency}`).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),lastBalance=balances.at(-1),expected=opening+receipts-payments;
  if(lastBalance){const gap=Number(lastBalance[2])-expected;insights.push({title:Math.abs(gap)<.02?'Cash balance reconciles':'Cash balance needs review',text:`Opening ${money(opening,metric.currency)} + receipts ${money(receipts,metric.currency)} − payments ${money(payments,metric.currency)} = ${money(expected,metric.currency)}. Reported closing: ${money(Number(lastBalance[2]),metric.currency)}${Math.abs(gap)<.02?'.':`; difference ${money(gap,metric.currency)}.`}`,source:compactSources(dataset.rows.filter(r=>String(r[1]).endsWith(' · '+metric.currency)).map(r=>String(r[7])))});}
 }
 return {metric,rows,points,breakdown,total,high,low,latest,change,insights};
}
export function interpretFinancial(prompt:string,dataset:Dataset,current:string,views:View[]){
 const p=prompt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/supprimer|retirer|masquer/g,'remove').replace(/tendance|evolution/g,'trend').replace(/mensuel(?:le)?s?|mois/g,'month').replace(/annuel(?:le)?s?|annees?/g,'year').replace(/synthese|resume|constats/g,'insights');
 const metrics=dataset.financial?.metrics||[];
 if(/forecast|predict|projection future|convert|conversion|only|filter|20\d{2}/.test(p))return {metric:current,views,reply:'I can summarize the figures already in this workbook and add trend or category views. I do not create forecasts, filter individual years, or convert currencies. Choose a source table or measure above the chart to change the analysis.'};
 let selected=current;const currency=p.match(/\b(usd|cdf|eur|gbp)\b/)?.[0]?.toUpperCase();
 const match=metrics.find(m=>(!currency||m.currency===currency)&&((/revenue|revenu/.test(p)&&/revenu|revenue/i.test(m.label))||(/receipt|entree/.test(p)&&m.role==='receipts')||(/payment|outflow|sortie/.test(p)&&m.role==='payments')||(/balance|solde/.test(p)&&m.role==='balance')||p.includes(m.label.toLowerCase())));
 if(!match && (currency || /revenue|revenu|receipt|entree|payment|outflow|sortie|balance|solde/.test(p)))return {metric:current,views,reply:'That measure or currency is not available in this source table. Choose one of the available measures above the chart.'};
 if(match)selected=match.id;
 const data=financialAnalysis(dataset,selected);let reply='';let next=[...views];
 if(/\b(remove|delete|hide)\b/.test(p)){const target=/category|categorie|breakdown/.test(p)?'region':/trend|month|year|quarter/.test(p)?'monthly':null;if(target)return {metric:current,views:views.filter(v=>v!==target),reply:views.includes(target as View)?'Removed this view from the dashboard.':'That view is not on this dashboard.'};}
 if(/region/.test(p))reply='No verified region field was detected in this financial table. I won’t invent regional data. You can add a category breakdown when one is available.';
 else if(/insight|summary|summari|analyse|analysis|analyze|uncover|clean|quality/.test(p)){reply=data?.insights.map(i=>`${i.title}: ${i.text} Source: ${i.source}`).join('\n\n')||'Choose a numeric measure to uncover insights.';if(!next.length)next=['monthly'];}
 else if(/category|categorie|breakdown/.test(p)){if((data?.breakdown.length||0)>1){next=[...new Set([...next,'region' as View])];reply='Added the category breakdown while keeping your trend.';}else reply='This selected measure has no distinct categories. Choose another measure or source table; no breakdown has been invented.';}
 else if(match||/trend|month|year|quarter|evolution/.test(p)){next=[...new Set([...next,'monthly' as View])];reply=`Showing ${selected} at the source’s ${dataset.financial?.granularity==='annual'?'annual':'monthly'} frequency. ${dataset.financial?.basis==='projection'?'These are workbook projections or plans.':''}`;}
 else reply='Try “Uncover insights”, “Show revenue trend”, “Show cash payments USD”, or “Add a category breakdown”. Available measures depend on this source table.';
 return {metric:selected,views:next,reply};
}
