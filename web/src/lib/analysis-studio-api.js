import * as api from './api.js'
export const analysisApiBase = `${(import.meta.env.VITE_API || '/v1').replace(/\/$/, '')}/analysis-studio`
export function createAnalysisRequest({principal,org,onExpired}) {
  if(!['author','client'].includes(principal)||!org) throw new Error('Select an authenticated client workspace.')
  const root=new URL(analysisApiBase,window.location.origin)
  return async (url,options={})=>{
    const target=new URL(url,window.location.origin)
    if(target.origin!==root.origin||!target.pathname.startsWith(root.pathname+'/'))throw new Error('Analysis credentials cannot be sent outside the configured API.')
    target.searchParams.set('org',org)
    const session=principal==='client'?api.getSession():null
    const token=principal==='client'?session?.token:api.getToken()
    if(!token||principal==='client'&&!api.sessionBelongsToOrg(session,org)){if(principal==='client')onExpired?.();throw new Error('Sign in to the selected client workspace.')}
    const headers=new Headers(options.headers||{});headers.set('Authorization','Bearer '+token)
    const response=await fetch(target,{...options,headers,credentials:'omit'})
    if(response.status===401&&principal==='client')onExpired?.()
    return response
  }
}
