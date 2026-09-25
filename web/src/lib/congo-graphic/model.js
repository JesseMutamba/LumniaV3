export const STORAGE_KEY='lumnia.congo-graphic.operations.v1';
export const DEMO_DATE='2026-09-25';
export const uid=(prefix)=>prefix+'-'+crypto.randomUUID();
export const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
export const isDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export const dateLabel=s=>s?new Date(s+'T12:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}):'Not set';
export function seed(){
 const places=[['Gombe · Central avenue','Gombe','12 × 4 m','A',2400,'Ready'],['Gombe · Central avenue','Gombe','12 × 4 m','B',2200,'Ready'],['Limete · Main junction','Limete','8 × 3 m','A',1600,'Needs attention'],['Ngaliema · West corridor','Ngaliema','12 × 4 m','A',2100,'Ready'],['Lemba · Market approach','Lemba','6 × 3 m','A',1250,'Ready'],['Gombe · Business district','Gombe','Digital · 6 × 3 m','A',3200,'Ready'],['Masina · East corridor','Masina','12 × 4 m','A',1800,'Offline'],['Kintambo · Retail junction','Kintambo','8 × 3 m','A',1500,'Ready'],['Lingwala · City approach','Lingwala','8 × 3 m','A',1400,'Ready'],['Ngaliema · Hill road','Ngaliema','6 × 3 m','A',1300,'Ready'],['Limete · Industrial approach','Limete','12 × 4 m','A',1900,'Ready'],['Lemba · Campus approach','Lemba','6 × 3 m','A',1100,'Needs attention']];
 const sites=places.map((p,i)=>({id:'s'+(i+1),code:'CG-KIN-'+String(i+1).padStart(3,'0'),name:p[0],city:'Kinshasa',area:p[1],address:'Illustrative location '+String(i===1?1:i+1).padStart(2,'0')+' · not a verified address',format:p[2],face:p[3],monthlyRate:p[4],condition:p[5],permitExpiry:i===2?'2026-10-10':'2027-03-31',notes:'Synthetic demonstration asset. Confirm dimensions, permissions and location from the site register.',archived:false,source:{file:'Illustrative site register',sheet:'Sites',row:i+2}}));
 const clients=[{id:'cl1',name:'Mavuno Telecom',contact:'Demo contact A',email:'contact@mavuno.example',phone:'',notes:'Fictional advertiser for demonstration.'},{id:'cl2',name:'Kivu Beverages',contact:'Demo contact B',email:'marketing@kivu.example',phone:'',notes:'Fictional advertiser for demonstration.'},{id:'cl3',name:'Makala Retail',contact:'Demo contact C',email:'team@makala.example',phone:'',notes:'Fictional advertiser for demonstration.'},{id:'cl4',name:'Horizon Mobility',contact:'Demo contact D',email:'hello@horizon.example',phone:'',notes:'Fictional advertiser for demonstration.'}];
 const contracts=[{id:'ct1',reference:'CG-2026-041',clientId:'cl1',name:'City connection',siteIds:['s1','s3','s6'],start:'2026-09-01',end:'2026-10-31',value:14400,status:'Confirmed',notes:'Illustrative two-month booking. Total excludes taxes.'},{id:'ct2',reference:'CG-2026-042',clientId:'cl2',name:'Fresh perspective',siteIds:['s4','s8'],start:'2026-09-01',end:'2026-09-30',value:3600,status:'Confirmed',notes:'Renewal discussion due.'},{id:'ct3',reference:'CG-2026-043',clientId:'cl3',name:'October storefronts',siteIds:['s5','s9'],start:'2026-10-01',end:'2026-10-31',value:2650,status:'Confirmed',notes:'Artwork approval pending.'},{id:'ct4',reference:'CG-2026-044',clientId:'cl4',name:'Mobility launch',siteIds:['s2','s10'],start:'2026-10-01',end:'2026-10-31',value:3500,status:'Draft',notes:'Drafts do not reserve inventory.'}];
 const workOrders=[{id:'wo1',siteId:'s3',contractId:'ct1',title:'Replace damaged lighting',type:'Maintenance',priority:'High',assignee:'Field team A',due:'2026-09-23',status:'In progress',cost:0,notes:'Check the power supply and replace the failed fixtures.'},{id:'wo2',siteId:'s7',contractId:'',title:'Inspect support structure',type:'Inspection',priority:'High',assignee:'Field team B',due:'2026-09-26',status:'Open',cost:0,notes:'Asset is offline pending inspection.'},{id:'wo3',siteId:'s5',contractId:'ct3',title:'Install October campaign',type:'Installation',priority:'Normal',assignee:'Field team A',due:'2026-09-30',status:'Scheduled',cost:0,notes:'Confirm final artwork before printing.'},{id:'wo4',siteId:'s9',contractId:'ct3',title:'Install October campaign',type:'Installation',priority:'Normal',assignee:'Unassigned',due:'2026-09-30',status:'Open',cost:0,notes:'Artwork approval pending.'},{id:'wo5',siteId:'s12',contractId:'',title:'Refresh faded face',type:'Maintenance',priority:'Normal',assignee:'Field team B',due:'2026-09-28',status:'Scheduled',cost:0,notes:'Replace weathered material.'}];
 return {version:1,sites,clients,contracts,workOrders,invoices:[{id:'in1',reference:'INV-2026-041',contractId:'ct1',amount:7200,due:'2026-09-15',payments:[{id:'p1',amount:3600,date:'2026-09-10',note:'Illustrative receipt'}]},{id:'in2',reference:'INV-2026-042',contractId:'ct2',amount:3600,due:'2026-09-20',payments:[]},{id:'in3',reference:'INV-2026-043',contractId:'ct3',amount:2650,due:'2026-10-05',payments:[]}],documents:[],activity:[{id:'a0',at:'2026-09-25T08:00:00Z',action:'Demonstration workspace created',detail:'12 bookable faces · 4 fictional clients · no live business data'}]};
}
export const bookingState=(c,date)=>c.status==='Draft'?'Draft':c.status==='Cancelled'?'Cancelled':c.end<date?'Expired':c.start>date?'Scheduled':'Active';
export const activeBookings=(db,siteId,date)=>db.contracts.filter(c=>c.status==='Confirmed'&&c.siteIds.includes(siteId)&&c.start<=date&&c.end>=date);
export const availability=(db,s,date)=>s.archived?'Archived':s.condition==='Offline'?'Offline':activeBookings(db,s.id,date).length?'Booked':'Available';
export const invoiceBalance=i=>Math.max(0,i.amount-i.payments.reduce((s,p)=>s+p.amount,0));
export const invoiceState=(i,date)=>invoiceBalance(i)<=0?'Paid':i.due<date?'Overdue':i.payments.length?'Part paid':'Open';
export const openWork=w=>!['Done','Cancelled'].includes(w.status);
export function conflicts(db,contract){if(contract.status!=='Confirmed')return [];return db.contracts.filter(c=>c.id!==contract.id&&c.status==='Confirmed'&&c.start<=contract.end&&c.end>=contract.start&&c.siteIds.some(id=>contract.siteIds.includes(id)));}
const num=(x)=>Number.isFinite(Number(x))&&Number(x)>=0&&Number(x)<=1e9;
export function validateRecord(db,type,r){
 if(type==='sites'){
  if(!r.code?.trim()||!r.name?.trim()||!r.city?.trim())throw Error('Site code, site name and city are required.');
  if(db.sites.some(s=>s.id!==r.id&&s.code.toLowerCase()===r.code.toLowerCase()))throw Error('That site code already exists. Each bookable face needs a unique code.');
  if(!num(r.monthlyRate))throw Error('Enter a valid nonnegative monthly rate.');
  if(r.permitExpiry&&!isDate(r.permitExpiry))throw Error('Enter a valid permit expiry date.');
  if(!['Ready','Needs attention','Offline'].includes(r.condition))throw Error('Select a valid site condition.');
 }
 if(type==='clients'){
  if(!r.name?.trim())throw Error('Client name is required.');
  if(r.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))throw Error('Enter a valid email address.');
 }
 if(type==='contracts'){
  if(!r.reference?.trim()||!r.name?.trim()||!db.clients.some(c=>c.id===r.clientId))throw Error('Contract reference, campaign name and client are required.');
  if(db.contracts.some(c=>c.id!==r.id&&c.reference.toLowerCase()===r.reference.toLowerCase()))throw Error('That contract reference already exists.');
  if(!isDate(r.start)||!isDate(r.end)||r.end<r.start)throw Error('Enter valid start/end dates, with the end on or after the start.');
  if(!num(r.value)||Number(r.value)<=0)throw Error('Contract value must be greater than zero.');
  if(!['Draft','Confirmed','Cancelled'].includes(r.status))throw Error('Invalid contract status.');
  if(!Array.isArray(r.siteIds)||!r.siteIds.length||new Set(r.siteIds).size!==r.siteIds.length)throw Error('Select at least one unique billboard face.');
  if(r.siteIds.some(id=>!db.sites.some(s=>s.id===id)))throw Error('A selected site no longer exists.');
  const old=db.contracts.find(c=>c.id===r.id);
  if(old&&old.status!=='Draft'&&(old.start!==r.start||old.end!==r.end||old.clientId!==r.clientId||old.value!==Number(r.value)||JSON.stringify([...old.siteIds].sort())!==JSON.stringify([...r.siteIds].sort())))throw Error('Confirmed contract terms are locked. Create a new booking for an extension or amendment.');
  if(old?.status==='Cancelled'&&r.status!=='Cancelled')throw Error('Create a new contract to reinstate a cancelled booking.');
  if(r.status==='Confirmed'&&(!old||old.status==='Draft')&&r.siteIds.some(id=>{const s=db.sites.find(s=>s.id===id);return s.archived||s.condition==='Offline';}))throw Error('Archived or offline faces cannot be booked.');
  const clash=conflicts(db,r);if(clash.length)throw Error('Booking conflict with '+clash.map(c=>c.reference).join(', ')+'. Dates are inclusive; choose another face or period.');
 }
 if(type==='workOrders'){
  if(!r.title?.trim()||!db.sites.some(s=>s.id===r.siteId)||!isDate(r.due))throw Error('Task title, site and valid due date are required.');
  if(r.contractId&&!db.contracts.some(c=>c.id===r.contractId&&c.siteIds.includes(r.siteId)))throw Error('The selected contract does not include this site.');
  if(!['Maintenance','Installation','Inspection','Removal'].includes(r.type)||!['Open','Scheduled','In progress','Done','Cancelled'].includes(r.status)||!['High','Normal','Low'].includes(r.priority))throw Error('Select a valid task type, priority and status.');
  if(!num(r.cost))throw Error('Enter a valid nonnegative cost.');
  if(r.status==='Done'&&!r.completionNote?.trim())throw Error('Add a completion note before marking the task done.');
 }
 if(type==='invoices'){
  const c=db.contracts.find(c=>c.id===r.contractId);
  if(!c||c.status==='Draft'||c.status==='Cancelled')throw Error('Choose a confirmed contract for billing.');
  if(!r.reference?.trim()||!isDate(r.due)||!num(r.amount)||Number(r.amount)<=0)throw Error('Invoice reference, valid due date and positive amount are required.');
  if(db.invoices.some(i=>i.id!==r.id&&i.reference.toLowerCase()===r.reference.toLowerCase()))throw Error('Invoice reference already exists.');
  const billed=db.invoices.filter(i=>i.contractId===r.contractId&&i.id!==r.id).reduce((sum,i)=>sum+i.amount,0);
  if(billed+Number(r.amount)>c.value+.001)throw Error('Total invoices would exceed the contract value. Remaining to invoice: '+money(c.value-billed));
 }
 return r;
}
export function log(db,action,detail){return {...db,activity:[{id:uid('event'),at:new Date().toISOString(),action,detail},...db.activity].slice(0,1000)};}
export function upsert(db,type,record){
 const r=structuredClone(record);for(const key of Object.keys(r))if(typeof r[key]==='string')r[key]=r[key].trim();for(const key of ['monthlyRate','value','cost','amount'])if(key in r)r[key]=Number(r[key]);
 validateRecord(db,type,r);const old=db[type].find(x=>x.id===r.id);let next={...db,[type]:old?db[type].map(x=>x.id===r.id?r:x):[...db[type],r]};
 if(type==='contracts'&&r.status==='Confirmed'&&(!old||old.status==='Draft')){
  const jobs=r.siteIds.filter(id=>!next.workOrders.some(w=>w.contractId===r.id&&w.siteId===id&&w.type==='Installation'&&w.status!=='Cancelled')).map(siteId=>({id:uid('work'),siteId,contractId:r.id,title:'Install · '+r.name,type:'Installation',priority:'Normal',assignee:'Unassigned',due:r.start,status:'Open',cost:0,notes:'Confirm artwork and access before installation.'}));next={...next,workOrders:[...next.workOrders,...jobs]};
 }
 if(type==='contracts'&&r.status==='Cancelled')next={...next,workOrders:next.workOrders.map(w=>w.contractId===r.id&&w.type==='Installation'&&openWork(w)?{...w,status:'Cancelled'}:w)};
 return log(next,(old?'Updated ':'Created ')+({sites:'site',clients:'client',contracts:'contract',workOrders:'work order',invoices:'invoice'}[type]),(r.code||r.reference||r.title||r.name)+(old&&r.status!==old.status?' · '+old.status+' → '+r.status:''));
}
export function archiveSite(db,id,date){const s=db.sites.find(s=>s.id===id);if(!s)throw Error('Site not found.');if(!s.archived&&(db.contracts.some(c=>c.status==='Confirmed'&&c.end>=date&&c.siteIds.includes(id))||db.workOrders.some(w=>w.siteId===id&&openWork(w))))throw Error('Resolve current/future bookings and open work orders before archiving this face.');return log({...db,sites:db.sites.map(x=>x.id===id?{...x,archived:!s.archived}:x)},s.archived?'Restored site':'Archived site',s.code);}
export function recordPayment(db,invoiceId,payment){const i=db.invoices.find(i=>i.id===invoiceId);const amount=Number(payment.amount);if(!i||!num(amount)||amount<=0||amount>invoiceBalance(i)+.001||!isDate(payment.date))throw Error('Enter a valid payment date and amount no greater than the outstanding balance.');return log({...db,invoices:db.invoices.map(x=>x.id===i.id?{...x,payments:[...x.payments,{...payment,id:uid('receipt'),amount}]}:x)},'Payment recorded',i.reference+' · '+money(amount));}
export function stats(db,date){const sites=db.sites.filter(s=>!s.archived);return {faces:sites.length,booked:sites.filter(s=>activeBookings(db,s.id,date).length).length,available:sites.filter(s=>availability(db,s,date)==='Available').length,active:db.contracts.filter(c=>bookingState(c,date)==='Active').length,overdueWork:db.workOrders.filter(w=>openWork(w)&&w.due<date).length,openWork:db.workOrders.filter(openWork).length,receivable:db.invoices.reduce((s,i)=>s+invoiceBalance(i),0),overdue:db.invoices.filter(i=>i.due<date).reduce((s,i)=>s+invoiceBalance(i),0)};}
export function validateWorkspace(d){
 const kinds=['sites','clients','contracts','workOrders','invoices','documents','activity'];
 if(!d||d.version!==1||kinds.some(k=>!Array.isArray(d[k])||d[k].length>5000))throw Error('This is not a supported Congo Graphic backup.');
 for(const k of kinds){const ids=new Set();for(const r of d[k]){if(!r||typeof r.id!=='string'||!r.id.trim()||ids.has(r.id))throw Error('Invalid or repeated record ID in '+k);ids.add(r.id);}}
 const textFields={sites:['code','name','city','area','address','face','format','condition','permitExpiry','notes'],clients:['name','contact','email','phone','notes'],contracts:['reference','name','clientId','start','end','status','notes'],workOrders:['siteId','contractId','title','type','priority','assignee','due','status','notes','completionNote'],invoices:['reference','contractId','due'],activity:['action','detail','at']};
 for(const [k,fields] of Object.entries(textFields))for(const r of d[k])for(const field of fields)if(r[field]!==undefined&&typeof r[field]!=='string')throw Error('Invalid text field in backup.');
 for(const [k,key] of [['sites','monthlyRate'],['contracts','value'],['workOrders','cost'],['invoices','amount']])for(const r of d[k])if(typeof r[key]!=='number'||!num(r[key]))throw Error('Invalid monetary value in backup.');
 for(const s of d.sites)if(s.source&&(typeof s.source.file!=='string'||typeof s.source.sheet!=='string'||!Number.isInteger(s.source.row)))throw Error('Invalid text field in backup.');
 for(const k of ['sites','clients','contracts','workOrders'])for(const r of d[k])validateRecord(d,k,r);
 for(const i of d.invoices){if(!d.contracts.some(c=>c.id===i.contractId)||!num(i.amount)||i.amount<=0||!isDate(i.due)||!Array.isArray(i.payments)||i.payments.some(p=>typeof p.amount!=='number'||typeof p.note!=='string'||!num(p.amount)||p.amount<=0||!isDate(p.date))||i.payments.reduce((s,p)=>s+p.amount,0)>i.amount+.001)throw Error('Invalid invoice or receipt in backup.');}
 for(const c of d.contracts)if(d.invoices.filter(i=>i.contractId===c.id).reduce((sum,i)=>sum+i.amount,0)>c.value+.001)throw Error('Invoices exceed contract value in backup.');
 for(const doc of d.documents){if(!['sites','clients','contracts','workOrders'].includes(doc.linkedType)||!d[doc.linkedType].some(r=>r.id===doc.linkedId)||typeof doc.name!=='string'||typeof doc.added!=='string'||!Number.isFinite(Date.parse(doc.added))||!/^data:(application\/pdf|image\/(png|jpeg));base64,[A-Za-z0-9+/=]+$/.test(doc.dataUrl||''))throw Error('Invalid document attachment in backup.');}
 return d;
}
