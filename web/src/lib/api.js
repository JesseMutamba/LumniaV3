/**
 * API client.
 *
 * Reads are public but keyed: a stakeholder's link carries ?k=<share key> and
 * that key fetches exactly one report. Writes carry an author bearer token,
 * held in localStorage on your machine and never shipped in the build.
 */
const BASE = import.meta.env.VITE_API || '/v1'
const TOKEN_KEY = 'lumnia.token'

export const getToken = () => localStorage.getItem(TOKEN_KEY) || ''
export const setToken = (t) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)
export const hasToken = () => !!getToken()

async function req(path, { method = 'GET', body, auth = false, raw = false } = {}) {
  const headers = {}
  if (auth) headers.Authorization = `Bearer ${getToken()}`
  if (body && !raw) headers['Content-Type'] = 'application/json'
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  })
  if (r.status === 204) return null
  const text = await r.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!r.ok) {
    const e = new Error(typeof data === 'string' ? data : JSON.stringify(data?.detail ?? data))
    e.status = r.status
    e.detail = data?.detail ?? data
    throw e
  }
  return data
}

/* -------------------------------------------------------------- reading */
export const health = () => req('/health')
export const listOrgs = () => req('/orgs')
export const listReports = (orgId) => req(`/orgs/${orgId}/reports`)
export const getReport = (id, key) => req(`/reports/${id}?k=${encodeURIComponent(key || '')}`)
export const getPortal = (orgId, key) =>
  req(`/portal/${orgId}?k=${encodeURIComponent(key || '')}`)

/* -------------------------------------------------------------- authoring */
export const createOrg = (org) => req('/orgs', { method: 'POST', body: org, auth: true })
export const listStudioOrgs = () => req('/studio/orgs', { auth: true })
export const rotateOrgKey = (id) =>
  req(`/studio/orgs/${id}/rotate-key`, { method: 'POST', auth: true })
export const getOrgContext = (id) => req(`/studio/orgs/${id}/context`, { auth: true })
export const reportReads = (id) => req(`/studio/reports/${id}/reads`, { auth: true })
export const saveOrgContext = (id, body) =>
  req(`/studio/orgs/${id}/context`, { method: 'PUT', body, auth: true })
export const getReportAsAuthor = (id) => req(`/studio/reports/${id}`, { auth: true })
export const setStatus = (id, s) =>
  req(`/studio/reports/${id}/status?new_status=${s}`, { method: 'PATCH', auth: true })
export const rotateKey = (id) =>
  req(`/studio/reports/${id}/rotate-key`, { method: 'POST', auth: true })
export const removeReport = (id) =>
  req(`/studio/reports/${id}`, { method: 'DELETE', auth: true })

export function importReport(file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('/studio/import', { method: 'POST', body: fd, auth: true, raw: true })
}

export function ingestWorkbook(files, orgId) {
  const fd = new FormData()
  for (const f of Array.isArray(files) ? files : [files]) fd.append('file', f)
  return req(`/studio/ingest?org=${encodeURIComponent(orgId || 'client')}`, {
    method: 'POST',
    body: fd,
    auth: true,
    raw: true,
  })
}

/** Share URL for a stakeholder. Same origin as whatever they're reading. */
export const shareUrl = (rep) =>
  `${location.origin}${location.pathname}#/r/${rep.id}?k=${rep.share_key}`

/** Portal URL for a client — one link, every published report behind it. */
export const portalUrl = (org) =>
  `${location.origin}${location.pathname}#/c/${org.id}?k=${org.share_key}`
