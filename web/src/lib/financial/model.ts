import {DriversSchema,RiskSchema} from './schema';
import type {Drivers,ForecastRow,PlanYear,Review,RiskSettings} from './types';
export const DEFAULT_DRIVERS:Drivers={pricePct:0,volumePct:0,extractionPp:0,opexPct:0,capexPct:0,variableCostPct:30};
export const DEFAULT_RISK:RiskSettings={trials:3000,seed:202609,priceStd:15,volumeStd:20,opexStd:10,extractionStd:1,year:2026};
export function ratio(n:number|null|undefined,d:number|null|undefined){return n!=null&&d!=null&&d>0?n/d:null}
export function forecastYear(p:PlanYear,d:Drivers,shocks={price:1,volume:1,opex:1,extraction:0}):ForecastRow|null{
 if(!DriversSchema.safeParse(d).success)throw new Error('Scenario inputs are outside the supported ranges.');
 const {revenue,opex,capex,ffb,cpo}=p;if([revenue,opex,capex,ffb,cpo].some(v=>v.value==null)||ffb.value!<=0||cpo.value!<=0)return null;
 const baseOer=cpo.value!/ffb.value!;if(baseOer<.01||baseOer>.45)return null;
 const extraction=Math.max(.01,Math.min(.45,baseOer+d.extractionPp/100+shocks.extraction));
 const volume=Math.max(0,(1+d.volumePct/100)*shocks.volume),fruit=ffb.value!*volume,oil=fruit*extraction;
 const price=revenue.value!/cpo.value!*Math.max(0,1+d.pricePct/100)*shocks.price;
 const operating=opex.value!*(1+d.opexPct/100)*shocks.opex*((1-d.variableCostPct/100)+d.variableCostPct/100*volume),investment=capex.value!*(1+d.capexPct/100),sales=oil*price;
 return {year:p.year,revenue:sales,opex:operating,capex:investment,ffb:fruit,cpo:oil,costPerTonne:ratio(operating,oil),operatingResult:sales-operating,afterCapex:sales-operating-investment,pricePerTonne:price,extraction};
}
export function forecast(review:Review,d:Drivers){return review.plan.filter(p=>review.forecastYears.includes(p.year)).flatMap(p=>{const r=forecastYear(p,d);return r?[r]:[]})}
export function seededRandom(seed:number){let a=seed>>>0;return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296}}
function normal(r:()=>number){return Math.sqrt(-2*Math.log(Math.max(r(),Number.EPSILON)))*Math.cos(2*Math.PI*r())}
function lognormal(r:()=>number,cv:number){const s=Math.sqrt(Math.log(1+(cv/100)**2));return Math.exp(s*normal(r)-.5*s*s)}
export function percentile(sorted:number[],p:number){if(!sorted.length)return null;const i=(sorted.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo)}
export function simulate(review:Review,d:Drivers,settings:RiskSettings){
 if(!RiskSchema.safeParse(settings).success)throw new Error('Simulation settings are outside the supported ranges.');
 const p=review.plan.find(p=>p.year===settings.year);if(!p)return null;
 const trials=Math.max(500,Math.min(10000,Math.round(settings.trials))),rng=seededRandom(settings.seed),runs:ForecastRow[]=[];
 for(let i=0;i<trials;i++){const row=forecastYear(p,d,{price:lognormal(rng,settings.priceStd),volume:lognormal(rng,settings.volumeStd),opex:lognormal(rng,settings.opexStd),extraction:normal(rng)*settings.extractionStd/100});if(row)runs.push(row)}
 if(!runs.length)return null;
 const summary=(key:'revenue'|'opex'|'afterCapex'|'operatingResult'|'costPerTonne')=>{const values=runs.flatMap(r=>r[key]===null?[]:[r[key] as number]).sort((a,b)=>a-b);return {p10:percentile(values,.1),p50:percentile(values,.5),p90:percentile(values,.9)}};
 const costs=runs.flatMap(r=>r.costPerTonne===null?[]:[r.costPerTonne]).sort((a,b)=>a-b),min=percentile(costs,.01)||0,max=percentile(costs,.99)||min+1,width=(max-min||1)/24;
 const buckets=Array.from({length:24},(_,i)=>({name:Math.round(min+(i+.5)*width).toLocaleString('en-US'),count:0,lower:min+i*width,upper:min+(i+1)*width}));for(const c of costs)buckets[Math.max(0,Math.min(23,Math.floor((c-min)/width)))].count++;
 return {trials:runs.length,seed:settings.seed,year:settings.year,cost:summary('costPerTonne'),revenue:summary('revenue'),opex:summary('opex'),operating:summary('operatingResult'),afterCapex:summary('afterCapex'),fundingGapProbability:runs.filter(r=>r.afterCapex<0).length/runs.length,operatingLossProbability:runs.filter(r=>r.operatingResult<0).length/runs.length,costAbovePriceProbability:runs.filter(r=>r.costPerTonne!==null&&r.costPerTonne>r.pricePerTonne).length/runs.length,buckets};
}
