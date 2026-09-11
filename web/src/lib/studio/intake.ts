import {analyzeWorkbooks,financialWorkbookRoles,type InspectedWorkbook} from '../financial/analyze-workbooks';
import {ReviewSchema} from '../financial/schema';
import type {Review} from '../financial/types';

export type UploadDecision =
 | {kind:'financial';review:Review}
 | {kind:'tables'}
 | {kind:'review';reason:string;plans:number[];actuals:number[]};

export function buildFinancialUpload(books:InspectedWorkbook[],planIndex:number,actualIndex?:number,title='Client financial review'):Review{
 const plan=books[planIndex],actual=actualIndex===undefined?undefined:books[actualIndex];
 if(!plan)throw new Error('Select a financial plan.');
 if(actualIndex!==undefined&&!actual)throw new Error('Select an available results workbook.');
 if(actual&&(actualIndex===planIndex||actual.sourceHash===plan.sourceHash))throw new Error('The plan and results must be different workbooks.');
 return ReviewSchema.parse(analyzeWorkbooks(plan,actual,title)) as Review;
}

/** Both Studio and financial review use this same dispatch and validated analyzer. */
export function routeUploadedWorkbooks(books:InspectedWorkbook[],title?:string):UploadDecision{
 const roles=books.map(financialWorkbookRoles),plans=roles.flatMap((r,i)=>r.plan?[i]:[]),actuals=roles.flatMap((r,i)=>r.actual?[i]:[]);
 if(!plans.length&&!actuals.length)return {kind:'tables'};
 if(new Set(books.map(b=>b.sourceHash)).size!==books.length)return {kind:'review',plans,actuals,reason:'A workbook was uploaded more than once. Select distinct plan and results sources.'};
 const plan=plans[0],results=actuals.filter(i=>i!==plan);
 if(plans.length===1&&((books.length===1)||(books.length===2&&results.length===1))){
  try{return {kind:'financial',review:buildFinancialUpload(books,plan,results[0],title)}}
  catch(e){return {kind:'review',plans,actuals,reason:e instanceof Error?e.message:'The financial definitions need review.'}}
 }
 return {kind:'review',plans,actuals,reason:!plans.length?'Operating results were detected. Add the financial plan to build the full comparison, or inspect these tables individually.':'Choose which workbook is the plan and which contains the results. Only the selected sources will be included in this review.'};
}
