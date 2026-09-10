// Read-only regression proposal. Run with Node; only writes its own result JSON in scratch.
// Tests exercise prepared semantic inputs, independent cached-value workbook controls, and economic identities.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
const root=process.cwd();
const bundled=await build({stdin:{contents:`export * from '${root}/src/lib/financial/analyze-workbooks.ts'; export * from '${root}/src/lib/financial/model.ts';`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const {analyzeWorkbooks,forecastYear,forecast,simulate,DEFAULT_DRIVERS,DEFAULT_RISK}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const results=[];
function test(name,fn){try{fn();results.push({name,status:'pass'});}catch(e){results.push({name,status:'FAIL',detail:e.message});}}
function near(a,b,tolerance=1e-7){assert.ok(typeof a==='number'&&Math.abs(a-b)<=Math.max(tolerance,Math.abs(b)*1e-9),`${a} differs from ${b}`);}
const clone=x=>structuredClone(x);
const fig=(value,unit='USD')=>({value,unit,refs:[]});
const control={year:2027,revenue:fig(230000),opex:fig(100000),capex:fig(50000),ffb:fig(1000,'t'),cpo:fig(230,'t'),hectares:fig(100,'ha'),balance:fig(80000)};
const modelReview={plan:[control],forecastYears:[2027]};
const metric=(id,currency='UNSPECIFIED')=>({id,label:id,currency,unit:currency==='USD'?'currency':'number',aggregation:'sum'});
const headers=['Period','Metric','Amount','Category','Currency','Unit','Basis','Source'];
const roles=[['revenue',230000,'USD'],['total opex',100000,'USD'],['total capex',50000,'USD'],['production ffb',1000,'UNSPECIFIED'],['production cpo',230,'UNSPECIFIED']];
function dataset(sheet,granularity,specs,year=2027,basis='projection'){
 const metrics=specs.map(([label,,currency])=>metric(label,currency));
 const rows=specs.flatMap(([label,value,currency],i)=>(granularity==='annual'?[0]:Array.from({length:12},(_,j)=>j+1)).map(month=>[month?`${year}-${String(month).padStart(2,'0')}`:String(year),label,month?value/12:value,label,currency,currency==='USD'?'currency':'number',basis==='projection'?'Projection / plan':'Recorded',`${sheet}!B${2+i*12+month}`]));
 return {name:'Unrelated client upload.xlsx',sheet,headers,rows,financial:{metrics,granularity,basis,title:'Semantic table'}};
}
function book(datasets,name='Unrelated client upload.xlsx'){
 return {name,sourceHash:'a'.repeat(64),datasets,sheets:datasets.map(d=>({name:d.sheet,rows:[{row:1,values:['Production in tonnes'],formats:['General'],formulas:[null]}],originalRows:100,formulaCount:0,formulaErrors:0,missingFormulaResults:0,issues:[]}))};
}
function fixture(){
 const annual=dataset('Business summary','annual',roles);
 const monthly=dataset('Operating schedule','monthly',[['total opex',100000,'USD'],["BU '27",1000,'UNSPECIFIED'],['CPO',230,'UNSPECIFIED']]);
 const actual=dataset('Observed operations','monthly',[['total site',80000,'USD'],['production ffb',800,'UNSPECIFIED'],['production cpo',184,'UNSPECIFIED']],2027,'recorded');
 actual.rows=actual.rows.filter(r=>Number(r[0].slice(5))<=3);
 return {p:book([annual,monthly]),a:book([actual],'Different actuals.xlsx')};
}

test('neutral drivers preserve every annual source measure and exclude CAPEX from OPEX/t',()=>{const r=forecastYear(control,DEFAULT_DRIVERS);for(const k of ['revenue','opex','capex','ffb','cpo'])near(r[k],control[k].value);near(r.costPerTonne,100000/230);near(r.afterCapex,80000);near(r.operatingResult,130000);});
test('price-only increase changes revenue, not costs or physical output',()=>{const r=forecastYear(control,{...DEFAULT_DRIVERS,pricePct:10});near(r.revenue,253000);near(r.opex,100000);near(r.cpo,230);near(r.afterCapex,103000);});
test('fixed operating costs remain fixed when volume rises',()=>{const r=forecastYear(control,{...DEFAULT_DRIVERS,volumePct:20,variableCostPct:0});near(r.cpo,276);near(r.opex,100000);near(r.costPerTonne,100000/276);});
test('fully variable operating cost tracks volume and preserves unit cost',()=>{const r=forecastYear(control,{...DEFAULT_DRIVERS,volumePct:20,variableCostPct:100});near(r.opex,120000);near(r.costPerTonne,100000/230);});
test('one extraction percentage point changes 23% to 24%',()=>{const r=forecastYear(control,{...DEFAULT_DRIVERS,extractionPp:1});near(r.extraction,.24);near(r.cpo,240);near(r.revenue,240000);});
test('missing CAPEX is unavailable rather than silently zero',()=>{assert.equal(forecastYear({...control,capex:fig(null)},DEFAULT_DRIVERS),null);});
test('impossible source extraction is rejected or neutral source values are preserved, never silently clamped',()=>{const source={...control,cpo:fig(600,'t')},r=forecastYear(source,DEFAULT_DRIVERS);assert.ok(r===null||Math.abs(r.cpo-600)<1e-9,`neutral model silently changed source CPO to ${r?.cpo}`);});
test('zero uncertainty reproduces deterministic economics at every percentile',()=>{const r=simulate(modelReview,DEFAULT_DRIVERS,{...DEFAULT_RISK,year:2027,trials:500,priceStd:0,volumeStd:0,opexStd:0,extractionStd:0});for(const p of ['p10','p50','p90']){near(r.cost[p],100000/230);near(r.afterCapex[p],80000);}assert.equal(r.fundingGapProbability,0);assert.equal(r.buckets.reduce((n,b)=>n+b.count,0),500);});
test('Monte Carlo is reproducible by seed with ordered quantiles and bounded probabilities',()=>{const settings={...DEFAULT_RISK,year:2027,trials:1000};const a=simulate(modelReview,DEFAULT_DRIVERS,settings),b=simulate(modelReview,DEFAULT_DRIVERS,settings),c=simulate(modelReview,DEFAULT_DRIVERS,{...settings,seed:settings.seed+1});assert.deepEqual(a,b);assert.notDeepEqual(a.cost,c.cost);assert.ok(a.cost.p10<=a.cost.p50&&a.cost.p50<=a.cost.p90);for(const k of ['fundingGapProbability','operatingLossProbability','costAbovePriceProbability'])assert.ok(a[k]>=0&&a[k]<=1);assert.equal(a.buckets.reduce((n,b)=>n+b.count,0),1000);});
test('renamed analogous 2027 upload maps by labels and BU year',()=>{const {p,a}=fixture(),r=analyzeWorkbooks(p,a);assert.equal(r.comparisonYear,2027);assert.equal(r.monthlyPlan.ffb.length,12);near(r.q1.find(q=>q.id==='opex').actual.value,20000);near(r.q1.find(q=>q.id==='ffb').actual.value,200);});
test('missing one actual month uses the same observed months for costs and both outputs',()=>{const {p,a}=fixture();a.datasets[0].rows=a.datasets[0].rows.filter(r=>!(r[1]==='production cpo'&&r[0]==='2027-03'));const r=analyzeWorkbooks(p,a);for(const q of r.q1)assert.deepEqual(q.actualMonths.map(m=>m.month),[1,2]);near(r.q1.find(q=>q.id==='opex').actual.value,80000/6);});
test('duplicate actual month is rejected before any ratio is calculated',()=>{const {p,a}=fixture();a.datasets[0].rows.push(clone(a.datasets[0].rows[0]));assert.throws(()=>analyzeWorkbooks(p,a),/duplicate/i);});
test('unconfirmed template periods are not observed actuals',()=>{const {p,a}=fixture();a.datasets[0].rows.find(r=>r[1]==='production cpo'&&r[0]==='2027-03')[6]='Unconfirmed template period';const r=analyzeWorkbooks(p,a);for(const q of r.q1)assert.deepEqual(q.actualMonths.map(m=>m.month),[1,2]);});
test('unknown plan currency cannot become USD by default',()=>{const {p}=fixture();for(const d of p.datasets){for(const m of d.financial.metrics)m.currency='UNSPECIFIED';for(const r of d.rows)r[4]='UNSPECIFIED';}assert.throws(()=>analyzeWorkbooks(p),/USD|currency/i);});
test('partially identified plan currencies still require each money metric to be USD',()=>{const {p}=fixture();const d=p.datasets[0];d.financial.metrics.find(m=>m.id==='total capex').currency='UNSPECIFIED';for(const r of d.rows)if(r[1]==='total capex')r[4]='UNSPECIFIED';assert.throws(()=>analyzeWorkbooks(p),/USD|currency/i);});
test('complete recorded/baseline year must not replace the projection comparison year',()=>{const {p}=fixture(),d=p.datasets[0];d.rows.unshift(...clone(d.rows).map(r=>{r[0]='2026';r[6]='Recorded';return r;}));const r=analyzeWorkbooks(p);assert.equal(r.comparisonYear,2027);assert.deepEqual(r.forecastYears,[2027]);});
test('OPEX subcategory before grand total cannot override total OPEX',()=>{const {p}=fixture(),d=p.datasets[0];d.financial.metrics.unshift(metric('OPEX payroll','USD'));d.rows.unshift(['2027','OPEX payroll',40000,'Payroll','USD','currency','Projection / plan','Business summary!B100']);let r;try{r=analyzeWorkbooks(p);}catch{return;}near(r.plan.find(y=>y.year===2027).opex.value,100000);});
test('conflicting equal-priority monthly schedules require mapping resolution',()=>{const {p}=fixture(),alternative=clone(p.datasets[1]);alternative.sheet='Another operating schedule';alternative.rows=alternative.rows.filter(r=>r[1]==='total opex');alternative.financial.metrics=alternative.financial.metrics.filter(m=>m.id==='total opex');alternative.rows[0][2]+=100;alternative.rows[3][2]-=100;p.datasets.push(alternative);p.sheets.push({...clone(p.sheets[1]),name:alternative.sheet});let r;try{r=analyzeWorkbooks(p);}catch{return;}assert.equal(r.monthlyPlan.opex.length,0,'ambiguous OPEX timing is still selected by input order');});
test('explicit actual currency conflict is never overridden by numerical identity',()=>{const {p,a}=fixture(),d=a.datasets[0];d.financial.metrics.find(m=>m.id==='total site').currency='CDF';d.rows.filter(r=>r[1]==='total site').forEach(r=>r[4]='CDF');const r=analyzeWorkbooks(p,a);assert.equal(r.q1.find(q=>q.id==='opex').unit,'UNVERIFIED');assert.ok(r.issues.some(i=>i.id==='actual-currency'));});
test('explicit monthly plan currency conflict leaves its mapping unavailable',()=>{const {p}=fixture(),d=p.datasets[1];d.financial.metrics.find(m=>m.id==='total opex').currency='CDF';d.rows.filter(r=>r[1]==='total opex').forEach(r=>r[4]='CDF');assert.equal(analyzeWorkbooks(p).monthlyPlan.opex.length,0);});
test('mixed actual years across measures remain provisional',()=>{const {p,a}=fixture();a.datasets[0].rows.filter(r=>r[1]==='production cpo').forEach(r=>r[0]=r[0].replace('2027','2026'));const r=analyzeWorkbooks(p,a);assert.ok(r.issues.some(i=>i.id==='period-conflict'));assert.ok(r.q1.every(q=>q.status==='review'));});
test('invalid Monte Carlo assumptions fail before simulation',()=>{assert.throws(()=>simulate(modelReview,DEFAULT_DRIVERS,{...DEFAULT_RISK,year:2027,trials:Infinity}));assert.throws(()=>forecastYear(control,{...DEFAULT_DRIVERS,opexPct:-200}));});
for(const r of results)console.log(`${r.status}: ${r.name}${r.detail?' — '+r.detail:''}`);

console.log(`${results.filter(r=>r.status==='pass').length}/${results.length} passed`);
process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
