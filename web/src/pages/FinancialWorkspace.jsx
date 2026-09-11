import {useEffect,useState,useCallback} from 'react'
import FinancialReview from '../components/financial/FinancialReview'
import * as api from '../lib/api'
import {requestWorkspaceNavigation} from '../lib/workspace-navigation.js'
const base=(import.meta.env.VITE_API||'/v1')+'/financial-reviews'
export default function FinancialWorkspace({orgs=[],locale}){
 const [org,setOrg]=useState(orgs[0]?.id||''),[context,setContext]=useState(null),[error,setError]=useState(''),[ready,setReady]=useState(false)
 useEffect(()=>{if(!org&&orgs.length)setOrg(orgs[0].id)},[orgs,org])
 useEffect(()=>{let active=true;setReady(false);setError('');setContext(null);if(org)api.getOrgContext(org).then(v=>{if(active){setContext(v);setReady(true)}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[org])
 const request=useCallback(async(url,options={})=>{const target=new URL(url,window.location.origin);target.searchParams.set('org',org);const headers=new Headers(options.headers||{});headers.set('Authorization',`Bearer ${api.getToken()}`);const response=await fetch(target,{...options,headers});const body=await response.json().catch(()=>({detail:'Unable to read the server response.'}));if(!response.ok)throw new Error(typeof body.detail==='string'?body.detail:body.error||'Please review the source data and retry.');return body},[org])
 const selectOrg=value=>{if(value!==org)requestWorkspaceNavigation(()=>setOrg(value))}
 return <div><div className="fr-financial-context"><label>Client <select aria-label="Financial review client" value={org} onChange={e=>selectOrg(e.target.value)}><option value="" disabled>Select client</option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name||o.id}</option>)}</select></label><small>Upload a financial plan and Q1 results to generate a source-linked review.</small>{context?.retain_files===false&&<strong>This client has disabled saving prepared files.</strong>}</div>{!org?<p>Create a client in Reports & operations to begin.</p>:error?<p role="alert">{error}</p>:!ready?<p role="status">Loading client settings…</p>:<FinancialReview key={org} apiBase={base} request={request} storageKey={'lumnia-financial:'+org} ignoreSheets={context?.ignore_sheets||[]} retainFiles={context?.retain_files!==false} studioHref="#/studio" embedded/>}</div>
}
