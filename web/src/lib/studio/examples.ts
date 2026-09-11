export function exampleFile(kind:string):File {
 let text='',name='';
 if(kind==='sales'){name='Northstar sales';text='Order ID,Date,Customer,Product,Region,Revenue USD,Cost USD,Quantity\n';const regions=['North','South','East','West'],products=['Essential','Plus','Enterprise'];for(let m=0;m<12;m++)for(let i=0;i<12;i++){const revenue=Math.round((220+m*23+i*17)*(i%3+1));text+=`NS-${m+1}-${i+1},2025-${String(m+1).padStart(2,'0')}-${String(i+2).padStart(2,'0')},Customer ${i+1},${products[i%3]},${regions[i%4]},${revenue},${Math.round(revenue*(.45+i%4*.04))},${i%7+2}\n`}}
 else if(kind==='inventory'){name='Inventory snapshots';text='Snapshot Date,SKU,Product,Warehouse,Stock,Reorder\n2026-01-31,0012,Widget,East,10,4\n2026-01-31,0013,Gadget,East,5,4\n2026-02-28,0012,Widget,East,14,4\n2026-02-28,0013,Gadget,East,3,4\n2026-02-28,0012,Widget,West,2,4\n'}
 else if(kind==='operations'){name='Production operations';text='Date,Site,Output tonnes,Cost USD,Run hours,Planned hours,Defects,Inspected units\n2026-01-01,Mill A,80,4000,70,80,8,800\n2026-02-01,Mill B,20,1500,25,30,2,200\n'}
 else {name='Observed revenue history';text='Month,Revenue USD\n';for(let i=0;i<24;i++)text+=`${2024+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}-01,${100+i*10}\n`}
 return new File([text],name+'.csv',{type:'text/csv'});
}
