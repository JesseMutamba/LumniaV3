import type { Cell } from './analytics';
export function parseNumber(value:Cell):number|null {
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(value==null)return null;
 let s=value.trim().replace(/[\u00a0\u202f\s]/g,'').replace(/(?:USD|CDF|EUR|GBP|CAD|AUD|FCFA|XOF|XAF|FC|[$€£])/gi,'');
 if(!s||/^(?:-|—|n\/a|na|null)$/i.test(s))return null;
 const neg=/^\(.*\)$/.test(s);if(neg)s=s.slice(1,-1);
 if(!/^[+-]?[\d.,]+$/.test(s))return null;
 if(s.includes(',')&&s.includes('.')) {if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
 else if(s.includes(',')){if(/^[+-]?\d{1,3}(,\d{3})+$/.test(s))s=s.replace(/,/g,'');else if((s.match(/,/g)||[]).length===1)s=s.replace(',','.');else return null;}
 const n=Number(s);return Number.isFinite(n)?(neg?-n:n):null;
}
