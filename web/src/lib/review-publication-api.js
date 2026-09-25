import * as api from './api.js'

export const publicationApiBase = `${(import.meta.env.VITE_API || '/v1').replace(/\/$/, '')}/review-publications`

export function createPublicationRequest({ org, onExpired }) {
  if (!org) throw new Error('Select your client workspace.')
  const root = new URL(publicationApiBase, window.location.origin)
  return async (url, options = {}) => {
    const target = new URL(url, window.location.origin)
    if (target.origin !== root.origin || (target.pathname !== root.pathname && !target.pathname.startsWith(root.pathname + '/'))) {
      throw new Error('Report credentials cannot be sent outside the configured API.')
    }
    const session = api.getSession()
    if (!api.sessionBelongsToOrg(session, org)) {
      onExpired?.()
      const error = new Error('Sign in to your client workspace.')
      error.status = 401
      throw error
    }
    target.searchParams.set('org', org)
    const headers = new Headers(options.headers || {})
    headers.set('Authorization', 'Bearer ' + session.token)
    const response = await fetch(target, { ...options, headers, credentials: 'omit' })
    if (response.status === 401) onExpired?.()
    if (response.status === 204) return null
    const body = await response.json().catch(() => null)
    if (!response.ok || body === null) {
      const detail = body?.detail ?? body?.error
      const error = new Error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map(item => item.msg).join('; ') : 'The report request couldn’t be completed. Please try again.')
      error.status = response.status
      throw error
    }
    return body
  }
}
