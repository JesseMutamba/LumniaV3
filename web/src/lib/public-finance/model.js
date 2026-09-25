// Illustrative demonstration only. No government statistics or client records.
export const COLUMNS = ['id','programme','institution','province','budget','engage','paye','cible','realise','echeance','statut'];
export const EXAMPLE_CSV = `id;programme;institution;province;budget;engage;paye;cible;realise;echeance;statut
PF-01;Centres de services numériques;Administration numérique;Kinshasa;2 400 000;1 800 000;1 200 000;24;12;2026-06-30;À suivre
PF-02;Connexion des écoles;Éducation;Kongo Central;1 800 000;1 100 000;650 000;60;18;2026-06-30;En retard
PF-03;Registre des établissements;Santé;Haut-Katanga;1 200 000;800 000;720 000;40;28;2026-09-30;En cours
PF-04;Formation des agents;Administration numérique;Kongo Central;600 000;480 000;420 000;120;92;2026-09-30;En cours
PF-05;Équipement des écoles;Éducation;Haut-Katanga;1 500 000;1 250 000;1 100 000;30;15;2026-06-30;En retard
PF-06;Systèmes de suivi sanitaire;Santé;Kinshasa;900 000;600 000;500 000;20;12;2026-09-30;En cours
PF-07;Portail de services;Administration numérique;Haut-Katanga;800 000;500 000;350 000;8;3;2026-09-30;À suivre
PF-08;Formation des enseignants;Éducation;Kinshasa;500 000;350 000;300 000;100;70;2026-09-30;En cours
PF-08;Formation des enseignants;Éducation;Kinshasa;500 000;350 000;300 000;100;70;2026-09-30;En cours
PF-09;Collecte des indicateurs;Santé;Kongo Central;400 000;250 000;;12;5;2026-09-30;À compléter`;

export function parseCSV(text) {
  const first = text.replace(/^\uFEFF/,'').split(/\r?\n/)[0];
  const delimiter = first.includes(';') ? ';' : ',';
  const rows=[]; let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++) { const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"'){field+='"';i++;} else if(!quoted && field.trim()) throw Error('Guillemet inattendu dans le CSV.'); else quoted=!quoted; }
    else if(!quoted && (c===delimiter || c==='\n')) {row.push(field.trim());field=''; if(c==='\n'){if(row.some(Boolean))rows.push(row);row=[];} }
    else if(c!=='\r')field+=c;
  }
  if(quoted)throw Error('Une cellule entre guillemets n’est pas fermée.');
  row.push(field.trim());if(row.some(Boolean))rows.push(row);
  if(rows.length<2)throw Error('Le fichier doit contenir un en-tête et au moins une ligne.');
  const headers=rows.shift().map(s=>s.replace(/^\uFEFF/,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase());
  if(new Set(headers).size!==headers.length)throw Error('Des colonnes portent le même nom.');
  const missing=COLUMNS.filter(c=>!headers.includes(c));
  if(missing.length)throw Error('Colonnes manquantes : '+missing.join(', ')+'. Téléchargez le modèle CSV.');
  if(rows.length>5000)throw Error('Cette démo accepte au maximum 5 000 lignes.');
  return rows.map((cells,i)=>({sourceRow:i+2,raw:Object.fromEntries(headers.map((h,j)=>[h,cells[j]??''])),width:cells.length,expected:headers.length}));
}
function number(value){const s=String(value).replace(/[\s\u00a0\u202f]/g,'').replace(',','.');return s && /^\d+(\.\d+)?$/.test(s)?Number(s):NaN;}
export function prepare(text){
  const source=parseCSV(text),accepted=[],issues=[],seen=new Map();let normalized=0;
  for(const {raw,sourceRow,width,expected} of source){
    const reasons=[]; const r={...raw,sourceRow};
    if(width!==expected)reasons.push('Nombre de cellules incorrect');
    for(const key of ['id','programme','institution','province','statut'])if(!r[key])reasons.push(key+' manquant');
    for(const key of ['budget','engage','paye','cible','realise']){
      r[key]=number(raw[key]);if((!Number.isFinite(r[key]) || r[key]>1e12))reasons.push(key+' manquant, non numérique ou supérieur à 1 000 milliards');
      else if(String(r[key])!==raw[key])normalized++;
    }
    if(!(r.budget>0))reasons.push('Budget doit être positif');
    if(!(r.cible>0))reasons.push('Cible doit être positive');
    if(r.paye>r.engage || r.engage>r.budget)reasons.push('Vérifier payé ≤ engagé ≤ budget');
    if(r.realise>r.cible)reasons.push('Réalisé supérieur à la cible : confirmer la cible');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.echeance)||!Number.isFinite(Date.parse(r.echeance))||new Date(r.echeance).toISOString().slice(0,10)!==r.echeance)reasons.push('Échéance invalide');
    if(seen.has(r.id))reasons.push('Identifiant déjà présent à la ligne '+seen.get(r.id));else seen.set(r.id,sourceRow);
    if(reasons.length)issues.push({sourceRow,id:r.id,reasons,raw});else accepted.push(r);
  }
  return {rows:accepted,issues,source,normalized,sourceText:text};
}
export const money = n => new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(n)+' $';
export const pct=n=>new Intl.NumberFormat('fr-FR',{style:'percent',maximumFractionDigits:1}).format(n);
export function summarize(rows){const totals=rows.reduce((a,r)=>({budget:a.budget+r.budget,engage:a.engage+r.engage,paye:a.paye+r.paye}),{budget:0,engage:0,paye:0});return {...totals,execution:totals.budget?totals.paye/totals.budget:0,delivery:rows.length?rows.reduce((s,r)=>s+r.realise/r.cible,0)/rows.length:0,late:rows.filter(r=>r.echeance<'2026-07-01'&&r.realise<r.cible).length};}
export function grouped(rows,key){return [...new Set(rows.map(r=>r[key]))].map(name=>({name,...summarize(rows.filter(r=>r[key]===name)),count:rows.filter(r=>r[key]===name).length}));}
export function scenario(rows,remainingChange=0,fundingChange=0){const t=summarize(rows);const remaining=Math.max(0,t.budget-t.paye);const estimate=t.paye+remaining*(1+remainingChange/100);const funding=t.budget*(1+fundingChange/100);return {estimate,funding,gap:Math.max(0,estimate-funding),remaining};}
export function toCSV(rows){const cell=v=>'"'+String(v).replace(/^[=+@\-]/,"'$&").replace(/"/g,'""')+'"';return '\uFEFF'+[COLUMNS.join(';'),...rows.map(r=>COLUMNS.map(k=>cell(r[k])).join(';'))].join('\n');}
