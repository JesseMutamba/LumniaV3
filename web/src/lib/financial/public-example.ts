import type {Workbook,Worksheet} from 'exceljs';
import {inspectSpreadsheet} from '../analytics/import-spreadsheet';
import {routeUploadedWorkbooks} from '../studio/intake';
import type {Review} from './types';

export const PUBLIC_FINANCIAL_EXAMPLE_TITLE='Illustrative estate — 2026 plan & Q1 review';
const USD='[$$-409]#,##0.00';
const XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const years=[2026,2027,2028,2029,2030];
const production=[6000,7800,9800,11500,13500];
const prices=[1000,1030,1050,1080,1100];
const operatingCosts=[780000,900000,1050000,1150000,1260000];
const capitalCosts=[600000,400000,300000,180000,100000];
const seasonalWeights=[7,7,8,8,9,10,10,10,9,8,7,7];

function finishSheet(sheet:Worksheet,moneyRows:number[]){
 sheet.getColumn(1).width=34;
 for(let column=2;column<=sheet.columnCount;column++)sheet.getColumn(column).width=16;
 sheet.getRow(1).font={bold:true,size:14};
 sheet.getRow(3).font={bold:true};
 for(const row of moneyRows)sheet.getRow(row).eachCell((cell,column)=>{if(column>1)cell.numFmt=USD});
 sheet.views=[{state:'frozen',xSplit:1,ySplit:3}];
}

async function workbookFile(workbook:Workbook,name:string):Promise<File>{
 workbook.creator='Lumnia public demonstration';
 workbook.created=new Date('2026-01-01T00:00:00Z');
 workbook.modified=new Date('2026-01-01T00:00:00Z');
 const bytes=await workbook.xlsx.writeBuffer();
 return new File([new Uint8Array(bytes)],name,{type:XLSX,lastModified:Date.UTC(2026,0,1)});
}

/** Entirely invented public examples. These are real uploadable workbooks, not client records. */
async function generatePublicFinancialFiles():Promise<File[]>{
 const ExcelJS=(await import('exceljs')).default;
 const plan=new ExcelJS.Workbook();
 const annual=plan.addWorksheet('Annual budget');
 annual.addRows([
  ['Synthetic demonstration — annual budget projections'],
  ['All figures are invented. Production in tonnes; monetary cells are USD.'],
  ['Measure',...years],
  ['Revenue',...years.map((_,i)=>({formula:`${String.fromCharCode(66+i)}6*${prices[i]}`,result:production[i]*.2*prices[i]}))],
  ['Production FFB',...production],
  ['Production CPO',...production.map((value,i)=>({formula:`${String.fromCharCode(66+i)}5*20%`,result:value*.2}))],
  ['CAPEX',...capitalCosts],
  ['Plantation labor',...operatingCosts.map(value=>value*.45)],
  ['Mill operations',...operatingCosts.map(value=>value*.35)],
  ['Logistics and support',...operatingCosts.map(value=>value*.2)],
  ['OPEX',...operatingCosts.map((value,i)=>({formula:`SUM(${String.fromCharCode(66+i)}8:${String.fromCharCode(66+i)}10)`,result:value}))],
  ['Hectares',500,600,700,800,900],
  ['Balance',...years.map((_,i)=>({formula:`${String.fromCharCode(66+i)}4-${String.fromCharCode(66+i)}11-${String.fromCharCode(66+i)}7`,result:production[i]*.2*prices[i]-operatingCosts[i]-capitalCosts[i]}))],
  ['Mill capacity',12000,12000,12000,12000,12000],
 ]);
 finishSheet(annual,[4,7,8,9,10,11,13]);
 const budget=plan.addWorksheet('Monthly budget');
 budget.addRows([
  ['Synthetic demonstration — 2026 monthly budget'],
  ['Production in tonnes. Seasonal weights are invented and sum to the annual budget.'],
  ['Measure',...seasonalWeights.map((_,i)=>`2026-${String(i+1).padStart(2,'0')}-01`)],
  ['OPEX',...seasonalWeights.map(value=>operatingCosts[0]*value/100)],
  ['Production FFB',...seasonalWeights.map(value=>production[0]*value/100)],
  ['Production CPO',...seasonalWeights.map(value=>production[0]*.2*value/100)],
 ]);
 finishSheet(budget,[4]);

 const actual=new ExcelJS.Workbook();
 const results=actual.addWorksheet('Quarterly operations');
 results.addRows([
  ['Synthetic demonstration — operating results'],
  ['Illustrative January–March 2026. Production in tonnes; no client data.'],
  ['Measure','2026-01-01','2026-02-01','2026-03-01'],
  ['Total plantations',34000,37000,42000],
  ['Total usine',17000,19000,21000],
  ['Total autres services',8000,8000,9000],
  ['Total site',...[59000,64000,72000].map((value,i)=>({formula:`SUM(${String.fromCharCode(66+i)}4:${String.fromCharCode(66+i)}6)`,result:value}))],
  ['Production FFB',360,390,450],
  ['Production CPO',68.4,78,85.5],
  ['Cost per tonne USD',...[59000/68.4,64000/78,72000/85.5].map((value,i)=>({formula:`${String.fromCharCode(66+i)}7/${String.fromCharCode(66+i)}9`,result:value}))],
 ]);
 finishSheet(results,[4,5,6,7,10]);
 return [await workbookFile(plan,'Lumnia_synthetic_plan_2026_2030.xlsx'),await workbookFile(actual,'Lumnia_synthetic_Q1_2026.xlsx')];
}

let exampleFiles:Promise<File[]>|undefined;
/** Reuse the exact source bytes for downloads and analysis so file fingerprints agree. */
export async function createPublicFinancialFiles():Promise<File[]>{
 if(!exampleFiles)exampleFiles=generatePublicFinancialFiles().catch(error=>{exampleFiles=undefined;throw error});
 return [...await exampleFiles];
}

/** Uses exactly the same spreadsheet inspection, classification and analysis as client uploads. */
export async function createPublicFinancialExample():Promise<Review>{
 const files=await createPublicFinancialFiles();
 const books=await Promise.all(files.map(file=>inspectSpreadsheet(file)));
 const decision=routeUploadedWorkbooks(books,PUBLIC_FINANCIAL_EXAMPLE_TITLE);
 if(decision.kind!=='financial')throw new Error(decision.kind==='review'?decision.reason:'The example workbooks could not be prepared.');
 return decision.review;
}
