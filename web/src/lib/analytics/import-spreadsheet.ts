import type { Cell, Dataset } from './analytics';
import type { RawSheet } from './import-types';
import { cleanSheets } from './cleaning';
function csvRows(text:string):Cell[][] {
 text=text.replace(/^\uFEFF/,'');
 const counts=[',',';','\t'].map(d=>({d,n:0}));let inQuotes=false,records=0;
 for(let i=0;i<text.length&&records<20;i++){const c=text[i];if(c==='"'){if(inQuotes&&text[i+1]==='"'){i++;continue}inQuotes=!inQuotes}else if(!inQuotes){if(c==='\n')records++;const candidate=counts.find(v=>v.d===c);if(candidate)candidate.n++}}
 counts.sort((a,b)=>b.n-a.n);
 const delimiter=counts[0].d,rows:Cell[][]=[];let row:Cell[]=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(cell||null);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell||null);rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw new Error('A quoted CSV field is unfinished. Check the source file.');row.push(cell||null);rows.push(row);return rows;
}
export async function inspectSpreadsheet(file:File,options:{ignoreSheets?:string[]}={}):Promise<{datasets:Dataset[];sheets:RawSheet[];sourceHash:string;name:string}> {
 if(file.size>8*1024*1024)throw new Error('Please choose a file smaller than 8 MB.');
 const sheets:RawSheet[]=[];
 const ignored=new Set((options.ignoreSheets||[]).map(s=>s.trim().toLowerCase()));
 if(/\.(csv|tsv)$/i.test(file.name)){
  const rows=csvRows(await file.text());
  sheets.push({name:'CSV data',originalRows:rows.length,rows:rows.map((values,i)=>({row:i+1,values,formats:[],formulas:[]})).filter(r=>r.values.some(v=>v!==null&&String(v).trim()!=='')),formulaCount:0,formulaErrors:0,missingFormulaResults:0,issues:[]});
 }else if(/\.(xlsx|xlsm)$/i.test(file.name)){
  const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  for(const sheet of workbook.worksheets){
   if(ignored.has(sheet.name.trim().toLowerCase()))continue;
   const raw:RawSheet={name:sheet.name,originalRows:sheet.rowCount,rows:[],formulaCount:0,formulaErrors:0,missingFormulaResults:0,issues:[]};
   let activeCells=0;
   sheet.eachRow(row=>{
    const values:Cell[]=[],formats:string[]=[],formulas:(string|null)[]=[];
    row.eachCell(cell=>{
     // Merged labels appear once. Do not replicate numeric values across merged cells.
     if(cell.isMerged&&cell.master.address!==cell.address)return;
     const index=Number(cell.col)-1;if(index>=150)throw new Error('Use no more than 150 populated columns per sheet.');
     activeCells++;if(activeCells>750000)throw new Error('This sheet has too many populated cells. Split it into smaller files.');
     formats[index]=cell.numFmt||'';
     let value:unknown=cell.value;
     if(cell.type===ExcelJS.ValueType.Formula){
      raw.formulaCount++;formulas[index]=cell.formula||null;
      // ExcelJS's serialized .value omits zero caches; the .result getter preserves them.
      value=cell.result;
      if(value===null||value===undefined){raw.missingFormulaResults++;}
     }
     if(value instanceof Date){if(Number.isNaN(value.getTime())){if(cell.type===ExcelJS.ValueType.Formula)raw.formulaErrors++;if(raw.issues.length<12)raw.issues.push({severity:'warning',message:'Invalid date cell retained as missing.',source:sheet.name+'!'+cell.address});value=null;}else value=value.toISOString().slice(0,10);}
     else if(value&&typeof value==='object'){
      if('error'in value){raw.formulaErrors++;if(raw.issues.length<8)raw.issues.push({severity:'warning',message:`${String(value.error)} retained as missing. Repair the formula in the source workbook.`,source:`${sheet.name}!${cell.address}`});value=null;}
      else if('richText'in value)value=(value.richText as {text:string}[]).map(t=>t.text).join('');
      else if('text'in value)value=String(value.text);
      else value=null;
     }
     values[index]=typeof value==='string'?value:typeof value==='number'&&Number.isFinite(value)?value:null;
    });
    if(values.some(v=>v!==null&&v!==undefined&&String(v).trim()!==''))raw.rows.push({row:row.number,values:Array.from({length:values.length},(_,i)=>values[i]??null),formats,formulas});
   });
   if(raw.rows.length>20001)throw new Error(`“${sheet.name}” has more than 20,000 populated rows. Split this sheet before importing.`);
   if(sheet.state!=='visible')raw.issues.push({severity:'info',message:'This source sheet is hidden in the workbook.'});
   sheets.push(raw);
  }
 }else throw new Error('Choose a CSV, TSV, or Excel (.xlsx) file.');
 for(const sheet of sheets)if(sheet.rows.length>20001)throw new Error('Use up to 20,000 populated rows per source table.');
 const allowed=sheets.filter(s=>!ignored.has(s.name.trim().toLowerCase()));
 if(!allowed.length)throw new Error('No source sheets remain after applying this client’s sheet exclusions.');
 const datasets=cleanSheets(allowed,file.name);
 for(const d of datasets)if(d.rows.length>20000)throw new Error('A detected table expands beyond 20,000 observations. Import a smaller date range.');
 const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
 const sourceHash=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
 return {datasets:datasets.map(d=>({...d,sourceHash})),sheets:allowed,sourceHash,name:file.name};
}

export async function importSpreadsheet(file:File,options:{ignoreSheets?:string[]}={}):Promise<Dataset[]> {
 return (await inspectSpreadsheet(file,options)).datasets;
}
