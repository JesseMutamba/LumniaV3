/** Read the hash without allowing a malformed identifier to crash the app. */
export function parseWorkspaceRoute(target = location) {
  const raw = target.hash.replace(/^#/, '') || '/'
  const [path, qs] = raw.split('?')
  const q = new URLSearchParams(qs || '')
  const views = {r:'report', a:'authorreport', m:'myreport', published:'publication', c:'portal'}
  const record = path.match(/^\/(r|a|m|published|c)\/([^/?]+)/)
  if (record) {
    let id
    try { id = decodeURIComponent(record[2]) }
    catch { return {view:'invalid'} }
    return {view:views[record[1]], id, ...(['r','c'].includes(record[1]) ? {key:q.get('k')} : {})}
  }
  if (/^\/(?:r|a|m|published|c)(?:\/|$)/.test(path)) return {view:'invalid'}
  if (path === '/analysis' || path === '/financial') return {view:'clientstudio'}
  if (path === '/reports') return {view:'clientreports'}
  if (path.startsWith('/studio')) return {view:'studio'}
  if (/^\/workspace(?:\/|$)/.test(target.pathname)) return {view:'clientstudio'}
  return {view:'home'}
}
