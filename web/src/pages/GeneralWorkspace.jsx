import {useEffect,useMemo,useState} from 'react'
import GeneralStudio from '../components/studio/GeneralStudio'
import * as api from '../lib/api.js'
import {analysisApiBase,createAnalysisRequest} from '../lib/analysis-studio-api.js'
import {financialApiBase,createFinancialRequest,financialStorageKey} from '../lib/financial-review-api.js'
import '../components/financial/financial-review.css'
import {WorkspaceState} from './WorkspaceSignIn.jsx'

function ScopedWorkspace({org,principal,onExpired,onSignOut,user,workspaceName}) {
  const request=useMemo(()=>createAnalysisRequest({principal,org,onExpired}),[principal,org])
  const financialRequest=useMemo(()=>createFinancialRequest({principal,org,onExpired}),[principal,org])
  const [context,setContext]=useState(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
  useEffect(()=>{let active=true;setContext(null);setError('');request(analysisApiBase+'/context?org='+encodeURIComponent(org)).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(typeof body.detail==='string'?body.detail:'Client settings could not be loaded.');if(active)setContext(body)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[request,org,attempt])
  if(error)return <WorkspaceState error={error} onRetry={()=>setAttempt(value=>value+1)}/>
  if(!context)return <WorkspaceState message="Preparing your workspace…"/>
  const storageKey=financialStorageKey({principal,org,user})
  return <GeneralStudio key={principal+':'+org} apiBase={analysisApiBase} request={request} financialApiBase={financialApiBase} financialRequest={financialRequest} financialStorageKey={storageKey} workspaceStorageKey={storageKey+':workspace'} workspaceName={workspaceName} onSignOut={onSignOut} reportsHref={principal==='client'?'#/reports':undefined} org={org} ignoreSheets={context.ignore_sheets||[]} retainFiles={context.retain_files!==false} financialHref={principal==='author'?'#/studio?workspace=financial':'#/analysis'} legacyHref={principal==='author'?'#/studio?workspace=explore':'#/reports'} embedded={principal==='author'}/>
}
export default function GeneralWorkspace({orgs=[]}) {
  const [org,setOrg]=useState(orgs[0]?.id||'')
  useEffect(()=>{if(!orgs.some(o=>o.id===org))setOrg(orgs[0]?.id||'')},[orgs,org])
  return <div><div className="fr-financial-context"><label>Client <select value={org} onChange={e=>setOrg(e.target.value)} aria-label="Analysis client"><option value="" disabled>Select client</option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name||o.id}</option>)}</select></label><small>Prepare, understand, analyze, and save dashboards for this client.</small></div>{org?<ScopedWorkspace key={'author:'+org} principal="author" org={org}/>:<p>Create a client in Reports & operations to begin.</p>}</div>
}
export function ClientAnalysisWorkspace({session,onExpired,onSignOut}) {
  const [verified,setVerified]=useState(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
  useEffect(()=>{let active=true;setVerified(null);setError('');api.whoami().then(value=>{if(active)setVerified(value)}).catch(e=>{if(active){if(e.status===401)onExpired();else setError(e.message)}});return()=>{active=false}},[session?.user?.username,session?.token,attempt])
  if(error)return <WorkspaceState error={error} onRetry={()=>setAttempt(value=>value+1)}/>
  if(!verified)return <WorkspaceState/>
  return <ScopedWorkspace key={'client:'+verified.user.username+':'+verified.org.id} principal="client" org={verified.org.id} onExpired={onExpired} onSignOut={onSignOut} user={verified.user} workspaceName={verified.org.name}/>
}
