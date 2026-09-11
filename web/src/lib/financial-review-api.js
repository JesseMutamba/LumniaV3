/** Financial review API adapter.
 * FinancialReview consumes parsed JSON; GeneralStudio consumes Response.
 * Keep the two adapters explicit so a Response cannot masquerade as a review.
 */
import * as api from './api.js'
export const financialApiBase = `${(import.meta.env.VITE_API || '/v1').replace(/\/$/, '')}/financial-reviews`

export function createFinancialRequest({principal,org,onExpired,retainFiles=true}) {
  if(!['author','client'].includes(principal)||!org)throw new Error('Select an authenticated client workspace.')
  const root=new URL(financialApiBase,window.location.origin)
  return async function request(url,options={}) {
    const target=new URL(url,window.location.origin)
    if(target.origin!==root.origin||(target.pathname!==root.pathname&&!target.pathname.startsWith(root.pathname+'/')))throw new Error('Financial credentials cannot be sent outside the configured review API.')
    target.searchParams.set('org',org)
    const session=principal==='client'?api.getSession():null
    const token=principal==='client'?session?.token:api.getToken()
    if(!token||principal==='client'&&!api.sessionBelongsToOrg(session,org)){
      if(principal==='client')onExpired?.()
      const error=new Error('Sign in to the selected client workspace.');error.status=401;throw error
    }
    const method=(options.method||'GET').toUpperCase()
    if(!retainFiles&&['POST','PUT'].includes(method)){
      const error=new Error('Saving prepared financial data is disabled by this client. Analysis is available for this session.');error.status=409;throw error
    }
    const headers=new Headers(options.headers||{});headers.set('Authorization','Bearer '+token)
    const response=await fetch(target,{...options,headers,credentials:'omit'})
    if(response.status===401&&principal==='client')onExpired?.()
    if(response.status===204)return null
    let body
    try{body=await response.json()}catch{const error=new Error('The server returned an unreadable financial review.');error.status=response.status;throw error}
    if(!response.ok){
      const detail=body?.detail??body?.error
      const message=typeof detail==='string'?detail:Array.isArray(detail)?detail.map(e=>e.msg).filter(Boolean).join('; '):'The financial review request failed.'
      const error=new Error(message);error.status=response.status;error.detail=detail;throw error
    }
    return body
  }
}

export function financialStorageKey({principal,org,user}) {
  const identity=user?.created_at||(user?.id!=null&&String(user.id)?'id:'+String(user.id):'')
  if(principal==='client'&&(!user?.username||!identity))throw new Error('Verify the client account before restoring a financial review.')
  return 'lumnia-financial-last:'+JSON.stringify([financialApiBase,principal,org,principal==='client'?user.username:'',principal==='client'?identity:''])
}
