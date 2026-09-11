/** Run from the Site checkout. Synthetic cases always run. Optional real uploads:
 * UPLOAD_FIXTURES_DIR=/absolute/private/upload-directory node /path/to/test-studio-intake.mjs
 * No source workbooks or raw client observations are embedded in this script.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const project=process.env.STUDIO_PROJECT_ROOT||process.cwd();
const require=createRequire(import.meta.url),{build}=require(path.join(project,'node_modules/esbuild/lib/main.js'));
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'lumnia-intake-test-'));
const results=[];
function test(name,fn){try{fn();results.push({name,status:'PASS'})}catch(e){results.push({name,status:'FAIL',message:e.message})}}
function sameReview(a,b){const strip=({createdAt,title,...rest})=>rest;assert.deepEqual(strip(a),strip(b))}
const clone=structuredClone;
function fixture(){
 const headers=['Period','Metric','Amount','Category','Currency','Unit','Basis','Source'];
 const make=(sheet,granularity,specs,sourceBasis,months=12)=>{const metrics=specs.map(([label,,currency])=>({id:label,label,currency,unit:currency==='USD'?'currency':'number',aggregation:'sum'}));return {name:sheet+'.xlsx',sheet,headers,financial:{metrics,granularity,basis:sourceBasis==='Recorded'?'recorded':'projection',title:sheet},rows:specs.flatMap(([name,total,currency],row)=>(granularity==='annual'?[0]:Array.from({length:months},(_,i)=>i+1)).map(month=>[month?'2027-'+String(month).padStart(2,'0'):'2027',name,month?total/12:total,name,currency,currency==='USD'?'currency':'number',sourceBasis,sheet+'!B'+(2+row*12+month)]))}};
 const wrap=(name,hash,datasets)=>({name,sourceHash:hash.repeat(64),datasets,sheets:datasets.map(d=>({name:d.sheet,rows:[{row:1,values:['Production in tonnes'],formulas:[],formats:[]}],originalRows:100,formulaCount:0,formulaErrors:0,missingFormulaResults:0,issues:[]}))});
 const plan=wrap('Client plan.xlsx','a',[make('Annual summary','annual',[['revenue',230000,'USD'],['total opex',100000,'USD'],['total capex',50000,'USD'],['production ffb',1000,'UNSPECIFIED'],['production cpo',230,'UNSPECIFIED']],'Projection / plan'),make('Budget schedule','monthly',[['total opex',100000,'USD'],["BU '27",1000,'UNSPECIFIED'],['CPO',230,'UNSPECIFIED']],'Projection / plan')]);
 const actual=wrap('Operating results.xlsx','b',[make('Observed costs and output','monthly',[['total site',80000,'USD'],['production ffb',800,'UNSPECIFIED'],['production cpo',184,'UNSPECIFIED']],'Recorded',3)]);
 const other=wrap('Sales.xlsx','c',[{name:'Sales',sheet:'Sales',headers:['Date','Revenue USD'],rows:[['2027-01-01',100]]}]);
 return {plan,actual,other};
}
try{
 await build({stdin:{contents:`export * from './src/lib/studio/intake.ts';export {financialWorkbookRoles,addOperatingResults} from './src/lib/financial/analyze-workbooks.ts';export * from './src/lib/financial/schema.ts';export * from './src/lib/financial/model.ts';export {inspectSpreadsheet} from './src/lib/analytics/import-spreadsheet.ts';`,resolveDir:project,sourcefile:'intake-test-entry.ts',loader:'ts'},outfile:path.join(tmp,'api.cjs'),bundle:true,format:'cjs',platform:'node',plugins:[{name:'external-exceljs',setup(b){b.onResolve({filter:/^exceljs$/},()=>({path:path.join(project,'node_modules/exceljs/excel.js'),external:true}))}}],logLevel:'silent'});
 const core=require(path.join(tmp,'api.cjs'));
 function exercise(label,plan,actual,other,seed){
  const forward=core.routeUploadedWorkbooks([plan,actual]);
  test(label+': plan + results routes to rich financial review',()=>{assert.equal(forward.kind,'financial');assert.equal(core.financialWorkbookRoles(plan).plan,true);assert.equal(core.financialWorkbookRoles(actual).actual,true)});
  if(forward.kind!=='financial')return;
  test(label+': reversed selection preserves all review fields',()=>{const reversed=core.routeUploadedWorkbooks([actual,plan]);assert.equal(reversed.kind,'financial');sameReview(forward.review,reversed.review)});
  test(label+': renamed uploads retain routing and numerical output',()=>{const renamed=core.routeUploadedWorkbooks([{...actual,name:'Later result upload.xlsx'},{...plan,name:'New finance source.xlsx'}]);assert.equal(renamed.kind,'financial');assert.deepEqual(renamed.review.plan.map(p=>[p.year,p.revenue.value,p.opex.value,p.capex.value,p.ffb.value,p.cpo.value]),forward.review.plan.map(p=>[p.year,p.revenue.value,p.opex.value,p.capex.value,p.ffb.value,p.cpo.value]));assert.deepEqual(renamed.review.q1.map(q=>[q.id,q.actual.value,q.plan.value,q.status]),forward.review.q1.map(q=>[q.id,q.actual.value,q.plan.value,q.status]));assert.deepEqual(renamed.review.bindings,forward.review.bindings);assert.deepEqual(renamed.review.sources.map(s=>s.name),['New finance source.xlsx','Later result upload.xlsx'])});
  test(label+': duplicate input never generates a double-counted dashboard',()=>{assert.equal(core.routeUploadedWorkbooks([plan,actual,{...actual,name:'Duplicate copy.xlsx'}]).kind,'review');assert.throws(()=>core.buildFinancialUpload([plan,{...plan,name:'Copy.xlsx'}],0,1),/different workbooks/)});
  test(label+': actual-only requests the missing plan',()=>{const d=core.routeUploadedWorkbooks([actual]);assert.equal(d.kind,'review');assert.deepEqual(d.plans,[]);assert.deepEqual(d.actuals,[0]);assert.match(d.reason,/Add the financial plan/)});
  test(label+': plan-only creates a financial dashboard without invented actuals',()=>{const d=core.routeUploadedWorkbooks([plan]);assert.equal(d.kind,'financial');assert.equal(d.review.q1.length,0);assert.ok(d.review.forecastYears.length>0)});
  test(label+': results added after reopening a saved plan match a joint upload',()=>{const planOnly=core.routeUploadedWorkbooks([plan]);assert.equal(planOnly.kind,'financial');const reopened=JSON.parse(JSON.stringify(planOnly.review)),before=clone(reopened),updated=core.addOperatingResults(reopened,actual);sameReview(updated,forward.review);assert.deepEqual(reopened,before,'Adding results mutated the retained plan');assert.equal(updated.createdAt,reopened.createdAt);assert.deepEqual(core.ReviewSchema.parse(updated),updated)});
  test(label+': replacing results removes old source references and never duplicates warnings',()=>{const renamed={...actual,name:'Replacement results.xlsx',sourceHash:'e'.repeat(64)},updated=core.addOperatingResults(JSON.parse(JSON.stringify(forward.review)),renamed),fresh=core.routeUploadedWorkbooks([plan,renamed]);assert.equal(fresh.kind,'financial');sameReview(updated,fresh.review);assert.deepEqual(updated.sources.map(s=>s.name),[plan.name,renamed.name]);assert.equal(new Set(updated.issues.map(i=>i.id)).size,updated.issues.length);assert.deepEqual(core.ReviewSchema.parse(updated),updated);sameReview(core.addOperatingResults(updated,renamed),updated)});
  test(label+': unrelated results cannot overwrite an existing financial review',()=>{const before=clone(forward.review);assert.throws(()=>core.addOperatingResults(forward.review,other),/monthly table|operating costs/);assert.deepEqual(forward.review,before);assert.throws(()=>core.addOperatingResults(forward.review,{...actual,name:plan.name}),/distinct filenames/);assert.throws(()=>core.addOperatingResults(forward.review,{...plan,name:'Renamed plan.xlsx'}),/different workbook/)});
  test(label+': unrelated extra workbook requires explicit source selection',()=>{const books=[other,actual,plan],d=core.routeUploadedWorkbooks(books);assert.equal(d.kind,'review');assert.deepEqual(d.plans,[2]);assert.deepEqual(d.actuals,[1]);sameReview(core.buildFinancialUpload(books,2,1),forward.review)});
  test(label+': incompatible plan currency surfaces review rather than a financial dashboard',()=>{const wrong=clone(plan);for(const d of wrong.datasets){for(const m of d.financial?.metrics||[])if(m.currency==='USD')m.currency='EUR';for(const r of d.rows)if(r[4]==='USD')r[4]='EUR'}const d=core.routeUploadedWorkbooks([wrong,actual]);assert.equal(d.kind,'review');assert.match(d.reason,/USD|currenc/i)});
  test(label+': save document serializes and validates the complete financial result',()=>{const original={title:forward.review.title,review:forward.review,drivers:{...core.DEFAULT_DRIVERS,volumePct:-10},risk:{...core.DEFAULT_RISK,year:forward.review.comparisonYear},tab:'risk',expected_version:4};const saved=core.FinancialDocument.parse(JSON.parse(JSON.stringify(original)));assert.deepEqual(saved,original);const bad=clone(saved);bad.review.plan[0].revenue.refs[0].file='Unknown file.xlsx';assert.equal(core.FinancialDocument.safeParse(bad).success,false)});
  if(seed)test(label+': full upload-generated review equals the seeded client dashboard',()=>sameReview(forward.review,seed));
 }
 const {plan,actual,other}=fixture();exercise('Synthetic',plan,actual,other);
 test('Replacing corrected results removes obsolete period, currency and source formula warnings',()=>{const flawed=clone(actual);flawed.datasets[0].rows.forEach(r=>{r[0]=r[0].replace('2027','2026');if(r[1]==='total site')r[4]='CDF'});flawed.datasets[0].financial.metrics.find(m=>m.id==='total site').currency='CDF';flawed.sheets[0].formulaErrors=1;flawed.sheets[0].rows[0].formulas=["'[External.xlsx]Sheet1'!A1"];const existing=core.routeUploadedWorkbooks([plan,flawed]);assert.equal(existing.kind,'financial');for(const id of ['period-conflict','actual-currency','formulas-'+actual.sourceHash,'external-'+actual.sourceHash])assert.ok(existing.review.issues.some(i=>i.id===id));const corrected={...actual,name:'Corrected results.xlsx',sourceHash:'f'.repeat(64)},updated=core.addOperatingResults(existing.review,corrected);for(const id of ['period-conflict','actual-currency','formulas-'+actual.sourceHash,'external-'+actual.sourceHash])assert.ok(!updated.issues.some(i=>i.id===id));sameReview(updated,core.routeUploadedWorkbooks([plan,corrected]).review)});
 test('Unrelated datasets stay in the general preparation workflow',()=>{assert.deepEqual(core.routeUploadedWorkbooks([other]),{kind:'tables'})});
 test('Two potential plans require explicit selection',()=>{const otherPlan={...clone(plan),sourceHash:'d'.repeat(64),name:'Alternative plan.xlsx'};const d=core.routeUploadedWorkbooks([plan,actual,otherPlan]);assert.equal(d.kind,'review');assert.deepEqual(d.plans,[0,2])});
 test('Same filenames are ambiguous even when workbook content differs',()=>{const d=core.routeUploadedWorkbooks([plan,{...actual,name:plan.name}]);assert.equal(d.kind,'review');assert.match(d.reason,/distinct filenames/)});
 test('Out-of-range explicit indices are rejected',()=>{assert.throws(()=>core.buildFinancialUpload([plan,actual],8,1),/Select a financial plan/);assert.throws(()=>core.buildFinancialUpload([plan,actual],0,8),/available results/)});
 const dir=process.env.UPLOAD_FIXTURES_DIR;
 if(dir){
  let seed=null;try{seed=JSON.parse(await fs.readFile(process.env.FINANCIAL_SEED_FILE||path.join(project,'data/pvak-review.json'),'utf8'))}catch{}
  const names=(await fs.readdir(dir)).filter(n=>/\.xlsx$/i.test(n));
  const preferred=seed?.sources?.map(s=>s.name)||[];
  names.sort((a,b)=>Number(preferred.includes(b))-Number(preferred.includes(a))||a.localeCompare(b));
  const unique=new Map();for(const name of names){const file=new File([await fs.readFile(path.join(dir,name))],name);const book=await core.inspectSpreadsheet(file);if(!unique.has(book.sourceHash))unique.set(book.sourceHash,book)}
  const books=[...unique.values()],plans=books.filter(b=>core.financialWorkbookRoles(b).plan),actuals=books.filter(b=>core.financialWorkbookRoles(b).actual);
  if(plans.length!==1||actuals.length!==1)throw new Error('UPLOAD_FIXTURES_DIR needs one distinct eligible plan and one results workbook (identical copies are deduplicated for fixture selection).');
  const matchedSeed=seed&&seed.sources.every(s=>unique.has(s.hash))?seed:null;exercise('Real XLSX',plans[0],actuals[0],other,matchedSeed);
 }else results.push({name:'Real XLSX fixtures',status:'SKIP',message:'Set UPLOAD_FIXTURES_DIR to run private workbook parity checks.'});
 const summary={passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length,skipped:results.filter(r=>r.status==='SKIP').length,results};console.log(JSON.stringify(summary,null,2));if(process.env.INTAKE_TEST_RESULTS)await fs.writeFile(process.env.INTAKE_TEST_RESULTS,JSON.stringify(summary,null,2)+'\n');process.exitCode=summary.failed?1:0;
}finally{await fs.rm(tmp,{recursive:true,force:true})}
