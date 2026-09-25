/**
 * API client.
 *
 * Reads are public but keyed: a stakeholder's link carries ?k=<share key> and
 * that key fetches exactly one report. Writes carry an author bearer token,
 * held in localStorage on your machine and never shipped in the build.
 */
const BASE = import.meta.env.VITE_API || '/v1'
const TOKEN_KEY = 'lumnia.token'

let memoryToken = ''
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || memoryToken } catch { return memoryToken } }
export const setToken = token => { memoryToken = token || ''; try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY) } catch {} }
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
export const listOrgs = () => req('/orgs', {auth:true})
export const listReports = (orgId) => req(`/studio/orgs/${encodeURIComponent(orgId)}/reports`, {auth:true})
export const getReport = (id, key) => req(`/reports/${id}?k=${encodeURIComponent(key || '')}`)
export const getPortal = (orgId, key) =>
  req(`/portal/${orgId}?k=${encodeURIComponent(key || '')}`)

/* -------------------------------------------------------------- authoring */
export const createOrg = (org) => req('/orgs', { method: 'POST', body: org, auth: true })
export const listStudioOrgs = () => req('/studio/orgs', { auth: true })
export const getDashboard = () => req('/studio/dashboard', { auth: true })
export const getTimeline = (id) => req(`/studio/orgs/${id}/timeline`, { auth: true })
export const ask = (body) => req('/studio/ask', { method: 'POST', body, auth: true })
export const getTiles = (id) => req(`/studio/orgs/${id}/tiles`, { auth: true })
const analysisPath = (org) => `/studio/orgs/${encodeURIComponent(org)}/analytics/dashboards`
export const listAnalysisDashboards = (org) => req(analysisPath(org), { auth: true })
export const openAnalysisDashboard = (org, id) => req(`${analysisPath(org)}/${encodeURIComponent(id)}`, { auth: true })
export const saveAnalysisDashboard = (org, body, id) => req(
  id ? `${analysisPath(org)}/${encodeURIComponent(id)}` : analysisPath(org),
  { method: id ? 'PUT' : 'POST', body, auth: true },
)
export const addTile = (id, question) =>
  req(`/studio/orgs/${id}/tiles`, { method: 'POST', body: { question }, auth: true })
export const removeTile = (id, tileId) =>
  req(`/studio/orgs/${id}/tiles/${tileId}`, { method: 'DELETE', auth: true })
export const rotateOrgKey = (id) =>
  req(`/studio/orgs/${id}/rotate-key`, { method: 'POST', auth: true })
export const deleteOrg = (id) => req(`/studio/orgs/${id}`, { method: 'DELETE', auth: true })
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
  // No silent default: a workbook filed under a guessed client is worse
  // than one not filed at all.
  if (!orgId) throw new Error('No client selected for this workbook.')
  const fd = new FormData()
  for (const f of Array.isArray(files) ? files : [files]) fd.append('file', f)
  return req(`/studio/ingest?org=${encodeURIComponent(orgId)}`, {
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

/* ---------------------------------------------------------------- clients
   A client session is a different principal from the author token: separate
   storage key, separate header, and it must never be sent to /studio. */
const SESSION_KEY = 'lumnia.session'
let memorySession = null
let memorySessionOnly = false

const validSession = s => Boolean(
  s && typeof s.token === 'string' && s.token.trim() &&
  typeof s.user?.username === 'string' && s.user.username.trim() &&
  typeof s.org?.id === 'string' && s.org.id.trim() &&
  typeof s.expires_at === 'number' && Number.isFinite(s.expires_at) &&
  s.expires_at * 1000 > Date.now()
)

export const getSession = () => {
  if (memorySessionOnly) return validSession(memorySession) ? memorySession : null
  let raw
  try {
    raw = localStorage.getItem(SESSION_KEY)
  } catch {
    return validSession(memorySession) ? memorySession : null
  }
  // A readable but empty storage key means another tab signed out. Only
  // unavailable storage may fall back to an in-memory session.
  try { memorySession = raw ? JSON.parse(raw) : null } catch { memorySession = null }
  if (!validSession(memorySession)) memorySession = null
  return memorySession
}

export const setSession = (s) => {
  memorySession = s
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else localStorage.removeItem(SESSION_KEY)
    memorySessionOnly = false
  } catch {
    // private browsing: the session lives for this page load only
    memorySessionOnly = true
  }
}

// The production portal stores the organization on session.org. Older Studio
// accounts also carry user.org; when present it must agree with that scope.
export const sessionBelongsToOrg = (session, org) => Boolean(
  session?.token && session.org?.id === org &&
  (session.user?.org == null || session.user.org === org)
)

const sessionHeaders = () => {
  const s = getSession()
  return s ? { Authorization: `Bearer ${s.token}` } : {}
}

export const login = (username, password) =>
  req('/auth/login', { method: 'POST', body: { username, password } })

// Accept the captured session so explicit sign-out may clear browser state
// immediately while this request revokes the same server session.
export const logout = (session = getSession()) => {
  if (typeof session?.token !== 'string' || !session.token.trim()) return Promise.resolve(null)
  return reqAs('/auth/logout', { Authorization: `Bearer ${session.token}` }, { method: 'POST', credentials: 'omit' })
}

export const whoami = () => reqAs('/auth/me', sessionHeaders())
export const myReports = () => reqAs('/me/reports', sessionHeaders())

/** A report opened by a signed-in client: no key in the URL, no key in the
 *  browser history, the session says who they are. */
export const getMyReport = (id) => reqAs(`/reports/${id}`, sessionHeaders())

async function reqAs(path, headers, options = {}) {
  const r = await fetch(`${BASE}${path}`, { ...options, headers })
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

/* ------------------------------------------------- author: client logins */
export const listOrgUsers = (id) => req(`/studio/orgs/${id}/users`, { auth: true })
export const createOrgUser = (id, username, password) =>
  req(`/studio/orgs/${id}/users`, { method: 'POST', body: { username, password }, auth: true })
export const setUserPassword = (username, password) =>
  req(`/studio/users/${username}/password`, { method: 'PUT', body: { password }, auth: true })
export const setUserDisabled = (username, disabled) =>
  req(`/studio/users/${username}/disable?disabled=${disabled}`, { method: 'POST', auth: true })
export const deleteUser = (username) =>
  req(`/studio/users/${username}`, { method: 'DELETE', auth: true })

export const saveDraftReport = rep => req(`/orgs/${encodeURIComponent(rep.org)}/reports`, {method:"POST", body:{...rep,status:"draft"},auth:true})
export const forgetWorkbooks = org => req(`/studio/orgs/${encodeURIComponent(org)}/files`, {method:"DELETE",auth:true})
