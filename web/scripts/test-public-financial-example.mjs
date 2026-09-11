import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
import ExcelJS from 'exceljs';

const output=new URL('../node_modules/.cache/public-financial-example-test.mjs',import.meta.url);
await build({stdin:{contents:`
 export * from './src/lib/financial/public-example.ts';
 export * from './src/lib/financial/model.ts';
 export * from './src/lib/financial/schema.ts';
 export * from './src/lib/analytics/import-spreadsheet.ts';
 export * from './src/lib/studio/intake.ts';
`,resolveDir:process.cwd(),loader:'ts'},bundle:true,packages:'external',format:'esm',platform:'node',outfile:output.pathname});
try{
 const {createPublicFinancialFiles,createPublicFinancialExample,inspectSpreadsheet,routeUploadedWorkbooks,ReviewSchema,forecast,simulate,DEFAULT_DRIVERS,DEFAULT_RISK}=await import(output.href);
 const files=await createPublicFinancialFiles();
 assert.equal(files.length,2);
 assert.ok(files.every(file=>file.name.startsWith('Lumnia_synthetic_')&&file.size<8*1024*1024));
 const books=await Promise.all(files.map(file=>inspectSpreadsheet(file)));
 const decision=routeUploadedWorkbooks(books);
 assert.equal(decision.kind,'financial');
 const review=ReviewSchema.parse(await createPublicFinancialExample());
 assert.deepEqual(review.forecastYears,[2026,2027,2028,2029,2030]);
 assert.equal(review.plan.length,5);
 assert.equal(review.sources.length,2);
 assert.deepEqual(review.sources.map(source=>source.hash),books.map(book=>book.sourceHash));
 assert.equal(review.sources.reduce((sum,source)=>sum+source.tables,0),3);
 assert.ok(review.sources.every(source=>source.formulaErrors===0&&source.missingFormulaResults===0));
 assert.equal(review.plan[0].revenue.value,1200000);
 assert.equal(review.plan[0].opex.value/review.plan[0].cpo.value,650);
 assert.equal(review.plan[0].balance.value,-180000);
 assert.equal(review.monthlyPlan.opex.length,12);
 assert.ok(review.q1.every(metric=>metric.actualMonths.length===3&&metric.planMonths.length===3));
 assert.equal(review.q1.find(metric=>metric.id==='opex').actual.value,195000);
 assert.equal(review.q1.find(metric=>metric.id==='cpo').actual.value,231.9);
 assert.equal(review.planCosts.reduce((sum,cost)=>sum+cost.value,0),780000);
 assert.equal(review.actualCosts.reduce((sum,cost)=>sum+cost.value,0),195000);
 assert.ok(review.issues.some(issue=>issue.id==='cost-scope'&&issue.severity==='warning'));
 assert.ok(review.issues.some(issue=>issue.id==='mill-capacity-Annual budget'&&issue.severity==='warning'));
 assert.ok(review.issues.some(issue=>issue.id==='actual-revenue'));
 assert.ok(review.bindings.length>=13);
 assert.equal(review.steps.length,6);
 console.log('PASS: real synthetic XLSX uploads produce complete, reconciled current financial review');

 const original=new ExcelJS.Workbook();
 await original.xlsx.load(await files[0].arrayBuffer());
 const reference=review.plan[0].opex.refs[0];
 assert.equal(original.getWorksheet(reference.sheet).getCell(reference.cell).result,review.plan[0].opex.value);
 assert.equal(reference.formula,'SUM(B8:B10)');
 console.log('PASS: source evidence points to genuine downloadable workbook cells and cached formulas');

 const actual=new ExcelJS.Workbook();
 await actual.xlsx.load(await files[1].arrayBuffer());
 actual.getWorksheet('Quarterly operations').getCell('B9').value=80;
 actual.getWorksheet('Quarterly operations').getCell('B10').value={formula:'B7/B9',result:59000/80};
 const edited=new File([new Uint8Array(await actual.xlsx.writeBuffer())],'Changed_operating_results.xlsx');
 const changed=routeUploadedWorkbooks([books[0],await inspectSpreadsheet(edited)]);
 assert.equal(changed.kind,'financial');
 assert.equal(changed.review.q1.find(metric=>metric.id==='cpo').actual.value,243.5);
 assert.notEqual(changed.review.q1.find(metric=>metric.id==='cpo').actual.value,decision.review.q1.find(metric=>metric.id==='cpo').actual.value);
 console.log('PASS: changing uploaded workbook cells changes the generated dashboard values');

 const baseline=forecast(review,DEFAULT_DRIVERS);
 const lowerVolume=forecast(review,{...DEFAULT_DRIVERS,volumePct:-10});
 assert.equal(baseline.length,5);
 assert.equal(baseline[0].costPerTonne,650);
 assert.equal(lowerVolume[0].cpo,1080);
 assert.ok(lowerVolume[0].costPerTonne>baseline[0].costPerTonne);
 const settings={...DEFAULT_RISK,year:2026,trials:500};
 const risk=simulate(review,DEFAULT_DRIVERS,settings);
 assert.deepEqual(risk,simulate(review,DEFAULT_DRIVERS,settings));
 assert.ok(risk.cost.p10<risk.cost.p50&&risk.cost.p50<risk.cost.p90);
 assert.equal(risk.buckets.reduce((sum,bucket)=>sum+bucket.count,0),500);
 console.log('PASS: scenario changes and reproducible Monte Carlo use the same production model');
}finally{await fs.unlink(output).catch(()=>{});}
