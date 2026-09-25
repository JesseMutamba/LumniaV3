import {uid,isDate} from './model.js';
export const FIELDS=[['code','Site code',true],['name','Site name',true],['city','City',true],['area','District',false],['address','Address',false],['face','Face',false],['format','Format / dimensions',false],['monthlyRate','Indicative monthly rate (USD)',false],['condition','Condition',false],['permitExpiry','Permit expiry',false],['notes','Notes',false]];
const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases={code:['code','sitecode','id','codesite','reference','identifiant'],name:['name','sitename','nom','nomdusite','site','emplacement'],city:['city','ville'],area:['district','area','commune','quartier'],address:['address','adresse','localisation'],face:['face','cote'],format:['format','dimensions','dimension','formatdimensions'],monthlyRate:['monthlyrate','rate','tarif','loyermensuel','prixmensuel','indicativemonthlyrateusd'],condition:['condition','etat','statut'],permitExpiry:['permitexpiry','expirationpermis','dateexpiration'],notes:['notes','observations','commentaires']};
export const guessMapping=headers=>Object.fromEntries(FIELDS.map(([key])=>[key,headers.findIndex(h=>aliases[key].includes(normalize(h)))]));
export function csvRows(text){
 const delimiter=text.split(/\r?\n/).slice(0,20).some(line=>line.includes(';'))?';':',';let out=[],row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===delimiter||c==='\n')){row.push(cell.trim());cell='';if(c==='\n'){out.push(row);row=[];}}else if(c!=='\r')cell+=c;}
 if(quoted)throw Error('The CSV contains an unclosed quoted cell.');row.push(cell.trim());if(row.some(Boolean))out.push(row);return out;
}
export async function readSheets(file){
 if(file.size>10*1024*1024)throw Error('Choose a file smaller than 10 MB.');
 if(/\.csv$/i.test(file.name))return [{name:'CSV',rows:csvRows(await file.text())}];
 if(!/\.xlsx$/i.test(file.name))throw Error('Choose an .xlsx or UTF-8 .csv file.');
 const mod=await import('exceljs');const ExcelJS=mod.default||mod;const wb=new ExcelJS.Workbook();await wb.xlsx.load(await file.arrayBuffer());
 return wb.worksheets.map(ws=>{if(ws.rowCount>5001||ws.columnCount>100)throw Error('Demo limit: 5,000 rows and 100 columns per sheet.');return {name:ws.name,rows:Array.from({length:ws.rowCount},(_,i)=>Array.from({length:ws.columnCount},(_,j)=>{const cell=ws.getCell(i+1,j+1);let v=cell.value;if(v&&typeof v==='object'&&'formula'in v)v=v.result;if(v instanceof Date)return v.toISOString().slice(0,10);if(v?.richText)return v.richText.map(t=>t.text).join('');if(v?.text)return v.text;if(v&&typeof v==='object')return '';return String(v??'');}))};});
}
export function previewSites(sheet,headerIndex,mapping,existing,filename){
 if(sheet.rows.length>5001)throw Error('Demo limit: 5,000 rows and 100 columns per sheet.');
 for(const [k,,required] of FIELDS)if(required&&!(mapping[k]>=0))throw Error('Map Site code, Site name and City before reviewing the import.');
 const columns=Object.values(mapping).filter(i=>i>=0);if(new Set(columns).size!==columns.length)throw Error('Each source column can be mapped only once.');
 const seen=new Set(existing.map(s=>s.code.trim().toLowerCase())),accepted=[],issues=[];
 sheet.rows.slice(headerIndex+1).forEach((cells,index)=>{
  if(!cells.some(c=>String(c).trim()))return;
  const r=Object.fromEntries(FIELDS.map(([key])=>[key,String(cells[mapping[key]]??'').trim()]));const reasons=[];const row=headerIndex+index+2;
  if(!r.code||!r.name||!r.city)reasons.push('Missing site code, name or city.');
  if(seen.has(r.code.toLowerCase()))reasons.push('Site code already exists; not overwritten.');
  const rate=r.monthlyRate.replace(/[\s\u00a0\u202f$]/g,'').replace(',','.');r.monthlyRate=rate===''?0:Number(rate);if(!Number.isFinite(r.monthlyRate)||r.monthlyRate<0||r.monthlyRate>1e9)reasons.push('Invalid monthly rate.');
  const conditions={ready:'Ready',bon:'Ready',disponible:'Ready',operationnel:'Ready',needsattention:'Needs attention',asurveiller:'Needs attention',maintenance:'Needs attention',offline:'Offline',horsservice:'Offline'};
  r.condition=r.condition?conditions[normalize(r.condition)]:'Ready';if(!r.condition)reasons.push('Unknown condition; use Ready, Needs attention or Offline.');
  if(r.permitExpiry&&!isDate(r.permitExpiry))reasons.push('Permit expiry must use YYYY-MM-DD.');
  if(reasons.length)issues.push({row,code:r.code,reasons});else{seen.add(r.code.toLowerCase());accepted.push({...r,id:uid('site'),face:r.face||'A',archived:false,source:{file:filename,sheet:sheet.name,row}});}
 });return {accepted,issues};
}
export const TEMPLATE='code;name;city;area;address;face;format;monthlyRate;condition;permitExpiry;notes\nCG-NEW-001;Example site;Kinshasa;Gombe;Enter verified address;A;12 x 4 m;2000;Ready;2027-06-30;Replace with your site details\n';
