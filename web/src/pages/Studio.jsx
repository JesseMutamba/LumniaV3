import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import * as api from '../lib/api.js'
import Block from '../blocks/index.jsx'
import { t } from '../lib/format.js'
import './analytics-workspace.css'
const GeneralWorkspace = lazy(() => import('./GeneralWorkspace.jsx'))
const FinancialWorkspace = lazy(() => import('./FinancialWorkspace.jsx'))
const AnalyticsWorkspace = lazy(() => import('./AnalyticsWorkspace.jsx'))

/**
 * Studio — the author's side of the platform.
 *
 * One job: get a report document into the platform and get a link out. It is
 * deliberately not an editor. You build the document elsewhere, where the
 * numbers and their cell addresses come from; Studio validates it, stores it,
 * and hands you a URL to send.
 */
export default function Studio({ locale, onPublished }) {
  const initialExplore = new URLSearchParams(location.hash.split('?')[1] || '').get('workspace') !== 'operations'
  const initialGeneral = !new URLSearchParams(location.hash.split('?')[1] || '').has('workspace') || new URLSearchParams(location.hash.split('?')[1] || '').get('workspace') === 'analysis'
  const initialFinancial = new URLSearchParams(location.hash.split('?')[1] || '').get('workspace') === 'financial'
  const [workspace, setWorkspace] = useState(initialGeneral ? 'analysis' : initialFinancial ? 'financial' : initialExplore ? 'explore' : 'operations')
  const [generalOpened,setGeneralOpened] = useState(initialGeneral)
  const [financialOpened,setFinancialOpened] = useState(initialFinancial)
  const [exploreOpened, setExploreOpened] = useState(initialExplore)
  useEffect(()=>{const sync=()=>{const mode=new URLSearchParams(location.hash.split('?')[1]||'').get('workspace');if(['analysis','financial','explore','operations'].includes(mode)){setWorkspace(mode);if(mode==='analysis')setGeneralOpened(true);if(mode==='financial')setFinancialOpened(true);if(mode==='explore')setExploreOpened(true)}};addEventListener('hashchange',sync);return()=>removeEventListener('hashchange',sync)},[])
  const [orgs, setOrgs] = useState([])
  const [token, setTok] = useState(api.getToken())
  const [pending, setPending] = useState(0)
  const busy = pending > 0
  const contextRequest = useRef(0)
  const usersRequest = useRef(0)
  const timelineRequest = useRef(0)
  const refreshRequest = useRef(0)
  const [reports, setReports] = useState([])
  const [err, setErr] = useState(null)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const [copiedOrg, setCopiedOrg] = useState(null)
  const [inv, setInv] = useState(null)
  const [ctxOrg, setCtxOrg] = useState(null)
  const [ctxText, setCtxText] = useState('')
  const [ctxMeta, setCtxMeta] = useState(null)
  const [ctxErr, setCtxErr] = useState(null)
  const [reads, setReads] = useState(null)
  const [usersOrg, setUsersOrg] = useState(null)
  const [users, setUsers] = useState(null)
  const [newUser, setNewUser] = useState({ username: '', password: '' })

  useEffect(() => {
    setReads(null)
    let cancelled = false
    if (result) api.reportReads(result.id).then(r => {if (!cancelled) setReads(r)}).catch(() => {})
    return () => {cancelled = true}
  }, [result])
  const [newOrg, setNewOrg] = useState({ id: '', name: '', sub: '' })

  const [dash, setDash] = useState([])
  const [tlOrg, setTlOrg] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [q, setQ] = useState('')
  const [qOrg, setQOrg] = useState('')
  const activeOrg = useRef(qOrg)
  activeOrg.current = qOrg
  const [qMode, setQMode] = useState('direct')
  const [answer, setAnswer] = useState(null)
  const [tiles, setTiles] = useState(null)

  const loadTiles = (org) => {
    if (org) api.getTiles(org).then(value => { if (activeOrg.current === org) setTiles(value) }).catch(() => { if (activeOrg.current === org) setTiles(null) })
  }
  // Changing client changes whose numbers these are: clear the answer with
  // the wall, or one client's figures sit on screen under another's name.
  useEffect(() => {
    let cancelled = false
    setReports([]); setResult(null); setReads(null)
    if (qOrg) api.listReports(qOrg).then(r => {if (!cancelled) setReports(r)}).catch(e => {if (!cancelled) setErr(e.message)})
    setAnswer(null)
    setTiles(null)
    setInv(null)
    loadTiles(qOrg)
    return () => {cancelled = true}
  }, [qOrg])

  async function pin(question) {
    const ok = await run(() => api.addTile(qOrg, question))
    if (ok) loadTiles(qOrg)
  }

  async function unpin(tileId) {
    await run(() => api.removeTile(qOrg, tileId))
    loadTiles(qOrg)
  }

  async function askQuestion(e) {
    e?.preventDefault()
    if (!q.trim()) return
    setAnswer(null)
    const org = qOrg || orgs[0]?.id
    if (!org) return
    const a = await run(() => api.ask({ org, question: q.trim(), mode: qMode }))
    if (a && activeOrg.current === org) setAnswer(a)
  }

  async function runPlan() {
    const org = qOrg || orgs[0]?.id
    const a = await run(() =>
      api.ask({
        org: qOrg || orgs[0]?.id,
        question: answer.question,
        mode: 'analyze',
        execute: true,
        plan: answer.plan,
      })
    )
    if (a && activeOrg.current === org) setAnswer(a)
  }

  async function openTimeline(id) {
    const request = ++timelineRequest.current
    if (tlOrg === id) {
      setTlOrg(null)
      return
    }
    setTlOrg(id)
    setTimeline([])
    api.getTimeline(id).then(v => {if (request === timelineRequest.current) setTimeline(v)}).catch(e => {if (request === timelineRequest.current) setErr(e.message)})
  }

  const L = locale === 'fr'
  const refresh = () => {
    const request = ++refreshRequest.current
    if (api.hasToken()) {
      api
        .listStudioOrgs()
        .then((os) => {
          if (request !== refreshRequest.current) return
          setOrgs(os)
          setQOrg((cur) => cur || os[0]?.id || '')
        })
        .catch(e => {if (request === refreshRequest.current) {setOrgs([]);setErr(e.status === 401 ? 'Author token rejected. Forget the token and sign in again.' : e.message)}})
      api.getDashboard().then(v => {if (request === refreshRequest.current) setDash(v)}).catch(() => {})
      if (qOrg) api.listReports(qOrg).then(v => {if (request === refreshRequest.current && activeOrg.current === qOrg) setReports(v)}).catch(() => {})
    }
  }
  useEffect(() => { refresh() }, [token])

  function saveToken(v) {
    api.setToken(v.trim())
    setTok(v.trim())
    setErr(null)
  }

  async function run(fn) {
    setPending(v => v + 1)
    setErr(null)
    try {
      return await fn()
    } catch (e) {
      setErr(e.detail ?? e.message)
      return null
    } finally {
      setPending(v => Math.max(0, v - 1))
    }
  }

  async function addOrg(e) {
    e.preventDefault()
    const ok = await run(() =>
      api.createOrg({
        id: newOrg.id.trim(),
        name: newOrg.name.trim(),
        sub: { fr: newOrg.sub.trim(), en: newOrg.sub.trim() },
      })
    )
    if (ok) {
      setNewOrg({ id: '', name: '', sub: '' })
      refresh()
    }
  }

  async function upload(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const selectedOrg = activeOrg.current
    const rep = await run(() => api.importReport(f))
    if (rep && selectedOrg === activeOrg.current) {
      setResult(rep)
      setCopied(false)
      refresh()
      onPublished?.()
    }
  }

  async function analyse(e) {
    const fs = [...(e.target.files || [])]
    e.target.value = ''
    if (!fs.length) return
    // The client selected above, not whichever one happens to be first:
    // filing a workbook under the wrong client corrupts both.
    const org = qOrg || orgs[0]?.id
    if (!org) return
    const r = await run(() => api.ingestWorkbook(fs, org))
    if (r && activeOrg.current === org) {
      setInv(r)
      loadTiles(org)
    }
  }

  const CTX_TEMPLATE = {
    ignore_sheets: [],
    units: {},
    aliases: {},
    exclude_labels: [],
  }
  const editable = (c) => {
    const { version, updated_at, ...doc } = c
    return doc
  }

  const loadUsers = (org) => {
    const request = ++usersRequest.current
    return api.listOrgUsers(org).then(v => {if (request === usersRequest.current) setUsers(v)}).catch(e => {if (request === usersRequest.current) {setUsers([]);setErr(e.message)}})
  }

  async function openUsers(o) {
    if (usersOrg === o.id) {
      usersRequest.current++; setUsersOrg(null)
      return
    }
    setUsersOrg(o.id)
    setUsers(null)
    setNewUser({ username: `${o.id}-`, password: '' })
    loadUsers(o.id)
  }

  /** A password you would not have thought of, which is the point. Generated
   *  in the browser and never stored here — you copy it out and hand it over. */
  function suggestPassword() {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    const pw = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 14)
    setNewUser((u) => ({ ...u, password: pw }))
  }

  async function addUser(e) {
    e.preventDefault()
    const ok = await run(() =>
      api.createOrgUser(usersOrg, newUser.username.trim(), newUser.password)
    )
    if (ok) {
      // The password is shown once, here, because after this request nobody
      // — including this platform — can read it back.
      alert(
        (L ? 'Accès créé.\n\nIdentifiant : ' : 'Login created.\n\nUsername: ') +
          newUser.username.trim() +
          (L ? '\nMot de passe : ' : '\nPassword: ') +
          newUser.password +
          (L
            ? "\n\nCopiez-le maintenant : il ne sera plus affiché."
            : '\n\nCopy it now — it will not be shown again.')
      )
      setNewUser({ username: `${usersOrg}-`, password: '' })
      loadUsers(usersOrg)
    }
  }

  async function resetPassword(u) {
    const pw = prompt(
      L
        ? `Nouveau mot de passe pour « ${u.username} » (10 caractères minimum) :`
        : `New password for “${u.username}” (10 characters minimum):`
    )
    if (!pw) return
    const ok = await run(() => api.setUserPassword(u.username, pw))
    if (ok) loadUsers(usersOrg)
  }

  async function openContext(o) {
    const request = ++contextRequest.current
    if (ctxOrg === o.id) {
      setCtxOrg(null)
      return
    }
    setCtxOrg(o.id)
    setCtxErr(null); setCtxMeta(null); setCtxText('')
    const c = await run(() => api.getOrgContext(o.id))
    if (request !== contextRequest.current) return
    setCtxMeta(c ? { version: c.version, updated_at: c.updated_at } : null)
    setCtxText(JSON.stringify(c ? editable(c) : CTX_TEMPLATE, null, 2))
  }

  async function saveContext() {
    setCtxErr(null)
    let body
    try {
      body = JSON.parse(ctxText)
    } catch (e) {
      setCtxErr(L ? `JSON invalide : ${e.message}` : `Invalid JSON: ${e.message}`)
      return
    }
    const request = contextRequest.current
    const c = await run(() => api.saveOrgContext(ctxOrg, body))
    if (c && request === contextRequest.current) {
      setCtxMeta({ version: c.version, updated_at: c.updated_at })
      setCtxText(JSON.stringify(editable(c), null, 2))
    }
  }

  function downloadDraft() {
    const blob = new Blob([JSON.stringify(inv.draft, null, 2)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${inv.draft.id}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function rotate() {
    const selectedOrg = activeOrg.current
    const rep = await run(() => api.rotateKey(result.id))
    if (rep && selectedOrg === activeOrg.current) {
      setResult(rep)
      setCopied(false)
    }
  }

  async function copy() {
    try {await navigator.clipboard.writeText(api.shareUrl(result));setCopied(true);setTimeout(() => setCopied(false), 2000)} catch {setErr('Could not copy automatically. Select and copy the link.')}
  }
  async function saveGeneratedDraft() {
    const selectedOrg = activeOrg.current
    const rep = await run(() => api.saveDraftReport(inv.draft))
    if (rep && selectedOrg === activeOrg.current) {setResult(rep);refresh()}
  }
  async function changeStatus(status) {
    const selectedOrg = activeOrg.current
    const rep = await run(() => api.setStatus(result.id, status))
    if (rep && selectedOrg === activeOrg.current) {setResult(rep);setCopied(false);refresh();onPublished?.()}
  }

  if (!api.hasToken())
    return (
      <div className="studio gate">
        <h2>{L ? 'Studio' : 'Studio'}</h2>
        <p>
          {L
            ? "Collez le jeton d'auteur pour publier. Il reste sur cette machine et n'est jamais envoyé au navigateur d'un lecteur."
            : 'Paste the author token to publish. It stays on this machine and is never shipped to a reader’s browser.'}
        </p>
        <input
          type="password"
          placeholder="LUMNIA_ADMIN_TOKEN"
          onKeyDown={(e) => e.key === 'Enter' && saveToken(e.target.value)}
          onBlur={(e) => saveToken(e.target.value)}
        />
        <div className="hint">{L ? 'Entrée pour valider' : 'Press Enter'}</div>
      </div>
    )

  return (
    <div className={`studio${workspace !== 'operations' ? ' studio-expanded' : ''}`}>
      <div className="studio-h">
        <h2>Studio</h2>
        <button className="link" onClick={() => saveToken('')}>
          {L ? 'oublier le jeton' : 'forget token'}
        </button>
      </div>

      <div className="studio-switch" role="tablist" aria-label={L ? 'Espace de travail' : 'Workspace'}>
        <button id="studio-analysis-tab" role="tab" aria-controls="studio-analysis-panel" aria-selected={workspace === 'analysis'} onClick={() => {setGeneralOpened(true);setWorkspace('analysis')}}>{L ? 'Préparation et analyse' : 'Prepare & analyze'}</button>
        <button id="studio-operations-tab" role="tab" aria-controls="studio-operations-panel" aria-selected={workspace === 'operations'} onClick={() => setWorkspace('operations')}>{L ? 'Rapports et opérations' : 'Reports & operations'}</button>
        <button id="studio-explore-tab" role="tab" aria-controls="studio-explore-panel" aria-selected={workspace === 'explore'} onClick={() => { setExploreOpened(true); setWorkspace('explore') }}>{L ? 'Studio analytique' : 'Analytics Studio'}</button>
        <button id="studio-financial-tab" role="tab" aria-controls="studio-financial-panel" aria-selected={workspace === 'financial'} onClick={() => {setFinancialOpened(true);setWorkspace('financial')}}>{L ? 'Revue financière' : 'Financial review'}</button>
      </div>
      <div id="studio-analysis-panel" role="tabpanel" aria-labelledby="studio-analysis-tab" hidden={workspace !== 'analysis'}>{generalOpened && <Suspense fallback={<p>Opening analytics studio…</p>}><GeneralWorkspace orgs={orgs}/></Suspense>}</div>
      <div id="studio-financial-panel" role="tabpanel" aria-labelledby="studio-financial-tab" hidden={workspace !== 'financial'}>{financialOpened && <Suspense fallback={<p>Preparing financial workspace…</p>}><FinancialWorkspace orgs={orgs} locale={locale}/></Suspense>}</div>
      {err && workspace === 'explore' && <div className="err-panel" role="alert">{typeof err === 'string' ? err : JSON.stringify(err)}</div>}
      <div id="studio-explore-panel" role="tabpanel" aria-labelledby="studio-explore-tab" hidden={workspace !== 'explore'}>
        {exploreOpened && <Suspense fallback={<div role="status">{L ? 'Ouverture…' : 'Opening workspace…'}</div>}><AnalyticsWorkspace orgs={orgs} locale={locale} onOperations={() => {setWorkspace('operations');refresh()}} /></Suspense>}
      </div>
      <div id="studio-operations-panel" className="studio-operations" role="tabpanel" aria-labelledby="studio-operations-tab" hidden={workspace !== 'operations'}>
      {/* --------------------------------------------------------- overview */}
      {dash.length > 0 && (
        <section className="panel">
          <div className="panel-h">
            {L ? "00 · Vue d'ensemble" : '00 · Overview'}
          </div>
          <div className="dash">
            {dash.map((d) => (
              <div key={d.id} className="dash-row">
                <span className="dash-name">
                  {d.name} <span className="mono muted">{d.id}</span>
                </span>
                <span className="dash-cell">
                  {d.published} {L ? 'publié(s)' : 'published'}
                  {d.unpublished > 0 &&
                    ` · ${d.unpublished} ${L ? 'brouillon(s)' : 'draft(s)'}`}
                </span>
                <span className="dash-cell">
                  {d.reads} {L ? 'lecture(s)' : 'read(s)'}
                  {d.last_read && ` · ${String(d.last_read).slice(0, 10)}`}
                  {d.refused > 0 && (
                    <span className="dash-bad">
                      {' '}· {d.refused} {L ? 'refusée(s)' : 'refused'}
                    </span>
                  )}
                </span>
                <span className="dash-cell">
                  {d.last_ingest
                    ? `${L ? 'ingéré le' : 'ingested'} ${String(d.last_ingest).slice(0, 10)} · ${d.files_tracked} ${L ? 'fichier(s)' : 'file(s)'}`
                    : L ? 'jamais ingéré' : 'never ingested'}
                </span>
                <span className="dash-cell">
                  {d.context_version
                    ? `${L ? 'contexte' : 'context'} v${d.context_version}${d.modules.length ? ` · ${d.modules.join(' · ')}` : ''}`
                    : L ? 'sans contexte' : 'no context'}
                </span>
                <button className="link" onClick={() => openTimeline(d.id)}>
                  {tlOrg === d.id
                    ? L ? 'fermer' : 'close'
                    : L ? 'chronologie' : 'timeline'}
                </button>
                {tlOrg === d.id && (
                  <div className="tl">
                    {timeline.length === 0 && (
                      <div className="tl-row">
                        <span className="muted">
                          {L
                            ? 'Aucune analyse pour ce client — chaque passage au panneau 02 laisse une ligne ici.'
                            : 'No analyse runs for this client yet — every pass through panel 02 leaves a row here.'}
                        </span>
                      </div>
                    )}
                    {timeline.map((run, i) => (
                      <div className="tl-row" key={i}>
                        <span className="tl-ts">{String(run.ts).slice(0, 10)}</span>
                        <span className="tl-facts">
                          {run.facts
                            .filter((f) => f.n != null)
                            .map((f, j) => (
                              <span className="tl-fact" key={j} data-tone={f.tone || 'neutral'}>
                                {f.label} ={' '}
                                {f.n}
                                {f.unit === 'pct' ? ' %' : ''}
                              </span>
                            ))}
                          {run.facts.filter((f) => f.n != null).length === 0 &&
                            (L ? 'aucun fait chiffré' : 'no numeric facts')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="fine">
            {L
              ? 'Une ligne par client : rapports sortis, lectures entrées, dernière ingestion, contexte appliqué.'
              : 'One row per client: reports out, reads in, last ingest, context applied.'}
          </p>
        </section>
      )}

      {/* -------------------------------------------------------------- ask */}
      <section className="panel">
        <div className="panel-h">{L ? '01 · Interroger' : '01 · Ask'}</div>
        <p>
          {L
            ? "Posez une question sur les livres de ce client. « Direct » répond avec ce qui a déjà été calculé — aucun chiffre n'est recalculé et aucun modèle n'y touche. « Analyser » montre d'abord son plan, puis relit les classeurs conservés."
            : 'Ask a question about this client’s books. “Direct” answers from what has already been computed — nothing is recomputed and no model touches a figure. “Analyse” shows its plan first, then re-reads the kept workbooks.'}
        </p>
        <form className="ask-form" onSubmit={askQuestion}>
          <input
            className="ask-q"
            placeholder={L ? "Quelle est l'exécution OPEX ?" : 'What is OPEX execution?'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select disabled={busy} value={qOrg} onChange={(e) => setQOrg(e.target.value)}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <div className="lens">
            {[
              ['direct', L ? 'Direct' : 'Direct'],
              ['analyze', L ? 'Analyser' : 'Analyse'],
            ].map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-selected={qMode === k}
                onClick={() => setQMode(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="submit" className="gold-btn" disabled={busy}>
            {busy ? (L ? '…' : '…') : L ? 'demander' : 'ask'}
          </button>
        </form>

        {(tiles?.tiles?.length > 0 || tiles?.pending?.length > 0) && (
          <div className="wall">
            {tiles.tiles.map((t) => (
              <div className="wall-t" key={t.id}>
                {t.block ? (
                  <Block b={t.block} locale={locale} sources={t.sources} />
                ) : (
                  <div className="note">
                    {L ? 'sans réponse dans les analyses récentes' : 'unanswered by recent analyses'}
                  </div>
                )}
                <div className="wall-f">
                  <span>
                    {t.as_of ? String(t.as_of).slice(0, 10) : '—'}
                  </span>
                  <button className="link" onClick={() => unpin(t.id)}>
                    {L ? 'retirer' : 'unpin'}
                  </button>
                </div>
              </div>
            ))}
            {tiles.pending.map((p) => (
              <div className="wall-t empty" key={p}>
                <div className="wall-q">{p}</div>
                <button className="link" onClick={() => pin(p)} disabled={busy}>
                  {L ? 'générer cette tuile' : 'generate this tile'}
                </button>
              </div>
            ))}
          </div>
        )}

        {answer && (
          <div className="ans">
            {answer.plan && (
              <div className="plan">
                <div className="plan-h">
                  {L ? 'Plan' : 'Plan'}
                  <span className="plan-by">
                    {answer.plan.planner === 'claude'
                      ? L ? 'choisi par Claude' : 'chosen by Claude'
                      : L ? 'choisi par règles' : 'chosen by rules'}
                  </span>
                </div>
                <p>{t(answer.plan.rationale, locale)}</p>
                <ul className="plan-l">
                  <li>
                    {L ? 'analyses' : 'analyses'} : {answer.plan.modules.join(' · ') || '—'}
                  </li>
                  {answer.plan.metrics.length > 0 && (
                    <li>
                      {L ? 'métriques' : 'metrics'} : {answer.plan.metrics.join(' · ')}
                    </li>
                  )}
                  <li>
                    {L ? 'classeurs' : 'workbooks'} : {answer.plan.files.join(' · ') || '—'}
                  </li>
                  <li>
                    {L ? 'contexte' : 'context'} :{' '}
                    {answer.plan.context_version ? `v${answer.plan.context_version}` : '—'}
                  </li>
                </ul>
                {answer.blocks.length === 0 && !answer.note && (
                  <button className="gold-btn" onClick={runPlan} disabled={busy}>
                    {busy
                      ? L ? 'analyse…' : 'analysing…'
                      : L ? 'lancer cette analyse' : 'run this analysis'}
                  </button>
                )}
              </div>
            )}
            {answer.note && <div className="note">{t(answer.note, locale)}</div>}
            {answer.as_of && (
              <div className="ans-asof">
                {L ? 'analyse du' : 'analysis of'} {String(answer.as_of).slice(0, 10)}
              </div>
            )}
            {answer.blocks.map((b, i) => (
              <Block key={i} b={b} locale={locale} sources={answer.sources} />
            ))}
            {answer.blocks.length > 0 && (
              <button className="link" onClick={() => pin(answer.question)}>
                {L ? 'épingler cette question' : 'pin this question'}
              </button>
            )}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- analyse */}
      <section className="panel">
        <div className="panel-h">
          {L ? '02 · Analyser un classeur' : '02 · Analyse a workbook'}
        </div>
        <p>
          {L
            ? 'Déposez un ou plusieurs classeurs (.xlsx) — budget et réel côte à côte. La machine détecte les tableaux, exécute les modules du contexte, et écrit un brouillon où chaque valeur porte sa cellule et son fichier source.'
            : 'Drop one or several workbooks (.xlsx) — budget and actuals side by side. The machine detects the tables, runs the context’s modules, and writes a draft in which every value carries its source cell and file.'}
        </p>
        <label className="drop">
          <input type="file" accept=".xlsx,.xlsm,.csv,.tsv" multiple onChange={analyse} hidden />
          {busy
            ? L ? 'Analyse…' : 'Analysing…'
            : L ? 'Choisir un ou des classeurs .xlsx' : 'Choose .xlsx workbook(s)'}
        </label>
        {orgs.length > 0 && (
          <p className="fine">
            {L ? 'Classé pour le client ' : 'Filed under client '}
            <b>{orgs.find((o) => o.id === (qOrg || orgs[0]?.id))?.name}</b>
            {L
              ? ' — le client choisi au panneau 01.'
              : ' — the client selected in panel 01.'}
          </p>
        )}
        {inv && (
          <div className="det">
            <details className="studio-quality" open={inv.needs_review}>
              <summary>{inv.needs_review ? (L ? 'Vérifications nécessitant une relecture' : 'Checks requiring review') : (L ? 'Vérifications des données' : 'Data checks')}</summary>
              {(inv.checks || []).map((check, i) => <div key={i} className={check.passed ? 'note' : 'aw-warning'}><strong>{check.passed ? (L ? 'Réussi' : 'Passed') : (L ? 'À vérifier' : 'Review')} · {check.name}</strong><p>{check.detail}</p></div>)}
            </details>
            {inv.tables.map((t, i) => (
              <div className="det-row" key={i}>
                <span className="det-loc">
                  {t.sheet}!{t.cells}
                </span>
                <span className="det-dim">
                  {t.rows}×{t.cols}
                  {t.notes.length > 0 && ` · ${t.notes.join(' · ')}`}
                </span>
                <span
                  className="det-conf"
                  data-band={t.confidence >= 0.8 ? 'high' : t.confidence >= 0.5 ? 'mid' : 'low'}
                >
                  {Math.round(t.confidence * 100)} %
                </span>
              </div>
            ))}
            {inv.tables.length === 0 && (
              <div className="note">
                {L
                  ? 'Aucun tableau détecté — le classeur est peut-être vide ou jamais recalculé par Excel.'
                  : 'No tables detected — the workbook may be empty or never recalculated by Excel.'}
              </div>
            )}
            {inv.modules_run?.length > 0 && (
              <div className="det-row">
                <span className="det-dim">
                  {L ? 'modules' : 'modules'} : {inv.modules_run.join(' · ')}
                </span>
              </div>
            )}
            {inv.ingestion && (
              <div className="delta">
                <div className="delta-h">
                  {L ? 'ingestion' : 'ingest'} #{inv.ingestion.seq}
                  {inv.ingestion.previous_ts &&
                    ` · ${L ? 'précédente le' : 'previous on'} ${String(inv.ingestion.previous_ts).slice(0, 10)}`}
                  {inv.ingestion.seq > 1 &&
                    inv.ingestion.changes.length === 0 &&
                    inv.ingestion.notes.length === 0 &&
                    ` · ${L ? 'aucun changement' : 'no changes'}`}
                </div>
                {inv.ingestion.alerts.map((a, i) => (
                  <div className="delta-row alert" key={i}>
                    <span>
                      {a.sheet} · {a.label} · {a.column}
                    </span>
                    <span>
                      {a.before} → {a.after}
                      {a.pct != null && ` (${a.pct > 0 ? '+' : ''}${a.pct} %)`}
                    </span>
                  </div>
                ))}
                {inv.ingestion.changes.length > inv.ingestion.alerts.length && (
                  <div className="delta-row">
                    <span>
                      {inv.ingestion.changes.length - inv.ingestion.alerts.length}{' '}
                      {L ? 'autre(s) changement(s) sous le seuil' : 'other change(s) below the threshold'}
                    </span>
                  </div>
                )}
                {inv.ingestion.notes.map((n, i) => (
                  <div className="delta-row" key={`n${i}`}>
                    <span>{n}</span>
                  </div>
                ))}
              </div>
            )}
            {inv.draft && (
              <>
                <button className="drop det-dl" disabled={busy} onClick={saveGeneratedDraft}>{L ? 'Enregistrer et vérifier le brouillon' : 'Save & review draft'}</button>
                <button className="link" onClick={downloadDraft}>
                  {L ? 'télécharger le brouillon .json' : 'download the draft .json'}
                </button>
                <p className="fine">
                  {L
                    ? 'Enregistrez le brouillon, ouvrez son aperçu, puis publiez-le après vérification.'
                    : 'Save the draft, open its preview, then publish after reviewing labels, units and source cells.'}
                </p>
              </>
            )}
          </div>
        )}
      </section>

      <section className="panel"><div className="panel-h">{L ? 'Bibliothèque des rapports' : 'Report library'}</div><p className="fine">{L ? 'Rapports du client sélectionné ci-dessus.' : 'Reports for the client selected above.'}</p>{reports.length ? reports.map(r => <div className="dash-row" key={r.id}><span>{t(r.title,locale)}</span><span className="mono">{r.status}</span><button className="link" disabled={busy} onClick={async () => {const selectedOrg=activeOrg.current;const rep=await run(() => api.getReportAsAuthor(r.id));if(rep && selectedOrg===activeOrg.current)setResult(rep)}}>{L ? 'Vérifier et partager' : 'Review & share'}</button></div>) : <p className="fine">{L ? 'Aucun rapport enregistré.' : 'No saved reports for this client.'}</p>}</section>
      {/* ---------------------------------------------------------- publish */}
      <section className="panel">
        <div className="panel-h">
          {L ? '03 · Publier un rapport' : '03 · Publish a report'}
        </div>
        <p>
          {L
            ? 'Déposez un document de rapport (.json) — écrit à la main ou issu du panneau 02, même règle : validé contre le schéma et contre CH-004, toute valeur sans cellule source est refusée avant enregistrement.'
            : 'Drop a report document (.json) — hand-written or from panel 02, same rule: validated against the schema and CH-004, any value without a source cell is refused before it is stored.'}
        </p>
        <label className="drop">
          <input type="file" accept=".json,application/json" onChange={upload} hidden />
          {busy
            ? L
              ? 'Validation…'
              : 'Validating…'
            : L
              ? 'Choisir un fichier .json'
              : 'Choose a .json file'}
        </label>
        <p className="fine">
          {L ? 'Pour rédiger à la main : ' : 'To write one by hand: '}
          <a className="link" href="modele-rapport.json" download>
            {L ? 'télécharger le modèle de rapport' : 'download the report template'}
          </a>
          {L
            ? ' — bilingue, devises explicites, chaque valeur avec sa cellule. Remplacez les chiffres et les cellules par les vôtres, puis déposez-le ici.'
            : ' — bilingual, explicit currencies, every value with its cell. Replace the figures and cells with yours, then drop it here.'}
        </p>
        {orgs.length === 0 && (
          <div className="note">
            {L
              ? "Aucun client pour l'instant — créez-en un ci-dessous avant de publier."
              : 'No clients yet — create one below before publishing.'}
          </div>
        )}
      </section>

      {/* ----------------------------------------------------------- errors */}
      {err && (
        <div className="err-panel">
          <b>{L ? 'Refusé' : 'Rejected'}</b>
          <pre>{typeof err === 'string' ? err : JSON.stringify(err, null, 1)}</pre>
        </div>
      )}

      {/* ------------------------------------------------------------ share */}
      {result && (
        <section className="panel ok">
          <div className="panel-h">{L ? '04 · Vérification et partage' : '04 · Review & share'}</div>
          <div className="pub-title">
            {orgs.find(o => o.id === result.org)?.name || result.org} · {t(result.title, locale)} · {t(result.period.label, locale)} ·{' '}
            <span className="mono">{result.status}</span>
          </div>
          <a className="link" href={`#/a/${result.id}`} target="_blank" rel="noreferrer">{L ? 'Ouvrir l’aperçu auteur' : 'Open author preview'}</a>
          {result.status === 'published' && <><div className="share">
            <code>{api.shareUrl(result)}</code>
            <button onClick={copy}>{copied ? (L ? 'copié' : 'copied') : L ? 'copier' : 'copy'}</button>
          </div>
          <p className="fine">
            {L
              ? "Quiconque a ce lien peut lire ce rapport et rien d'autre. Aucun compte requis."
              : 'Anyone with this link can read this one report and nothing else. No account required.'}
          </p>
          </>}
          {result.status !== 'published' && <p className="fine">{L ? 'Ce rapport est privé. Publiez-le pour activer son lien lecteur.' : 'This report is private. Publish it to activate the reader link.'}</p>}
          {reads && (
            <div className="reads">
              {reads.reads} {L ? 'lecture(s)' : 'read(s)'} · {reads.readers}{' '}
              {L ? 'lecteur(s)' : 'reader(s)'}
              {reads.last_read &&
                ` · ${L ? 'dernière le' : 'last on'} ${String(reads.last_read).slice(0, 10)}`}
              {reads.refused > 0 &&
                ` · ${reads.refused} ${L ? 'tentative(s) refusée(s)' : 'refused attempt(s)'}`}
              {'  '}
              <button
                className="link"
                onClick={() => api.reportReads(result.id).then(setReads).catch(() => {})}
              >
                {L ? 'actualiser' : 'refresh'}
              </button>
            </div>
          )}
          <div className="row-actions">
            <button className="link" onClick={rotate}>
              {L ? 'régénérer la clé' : 'rotate key'}
            </button>
            <button
              className="link"
              disabled={busy} onClick={() => changeStatus(result.status === 'published' ? 'retracted' : 'published')}
            >
              {result.status === 'published' ? (L ? 'Retirer le rapport' : 'Retract report') : (L ? 'Publier le rapport' : 'Publish report')}
            </button>
          </div>
        </section>
      )}

      <section className="panel"><div className="panel-h">{L ? 'Conservation des fichiers' : 'Workbook retention'}</div><p>{L ? 'Supprimez les copies des classeurs conservées pour le client sélectionné. Les rapports, les tableaux sauvegardés et les historiques restent disponibles.' : 'Delete retained workbook copies for the selected client. Reports, saved dashboards and analysis history remain available.'}</p><button className="link" disabled={busy || !qOrg} onClick={async () => {if(!confirm(L ? 'Supprimer les copies conservées de ce client ?' : 'Delete retained workbook copies for this client?'))return;const ok=await run(() => api.forgetWorkbooks(qOrg));if(ok){setAnswer(null);refresh()}}}>{L ? 'Supprimer les classeurs conservés' : 'Delete retained workbook copies'}</button></section>
      {/* ----------------------------------------------------------- clients */}
      <section className="panel">
        <div className="panel-h">{L ? '05 · Clients' : '05 · Clients'}</div>
        {orgs.length > 0 && (
          <div className="org-list">
            {orgs.map((o) => (
              <div key={o.id} className="org-row">
                <span className="mono">{o.id}</span>
                <span>{o.name}</span>
                <span className="muted">
                  {o.report_count} {L ? 'rapports' : 'reports'}
                </span>
                {/* A portal link for a client with nothing published opens to
                    an empty page. Say so rather than hand it over. */}
                <button
                  className="link"
                  disabled={o.report_count === 0}
                  title={
                    o.report_count === 0
                      ? L
                        ? 'Rien de publié — ce lien ouvrirait sur une page vide'
                        : 'Nothing published — this link would open on an empty page'
                      : undefined
                  }
                  onClick={() => {
                    navigator.clipboard.writeText(api.portalUrl(o))
                    setCopiedOrg(o.id)
                    setTimeout(() => setCopiedOrg(null), 2000)
                  }}
                >
                  {copiedOrg === o.id
                    ? L ? 'copié' : 'copied'
                    : L ? 'lien portail' : 'portal link'}
                </button>
                <button className="link" onClick={() => openContext(o)}>
                  {ctxOrg === o.id ? (L ? 'fermer' : 'close') : (L ? 'contexte' : 'context')}
                </button>
                <button className="link" onClick={() => openUsers(o)}>
                  {usersOrg === o.id
                    ? L ? 'fermer' : 'close'
                    : L ? 'accès' : 'logins'}
                </button>
                {/* Only offered where it is safe: a client holding a report is
                    refused by the API anyway, since somebody holds that link. */}
                {o.report_count === 0 && (
                  <button
                    className="link"
                    onClick={() => {
                      const msg = L
                        ? `Supprimer « ${o.name} » ? Aucun rapport publié — le contexte et les classeurs conservés partent avec.`
                        : `Delete “${o.name}”? Nothing published — its context and retained workbooks go with it.`
                      if (confirm(msg)) run(() => api.deleteOrg(o.id)).then(refresh)
                    }}
                  >
                    {L ? 'supprimer' : 'delete'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {usersOrg && (
          <div className="ctx">
            <div className="ctx-h">
              <b>{L ? 'Accès client' : 'Client logins'}</b>
              <span className="muted">{usersOrg}</span>
            </div>
            <p className="fine">
              {L
                ? "Vous créez l'identifiant et transmettez le mot de passe une seule fois. Il n'est pas récupérable ensuite, seulement remplaçable — il n'y a pas d'e-mail de réinitialisation."
                : 'You create the login and hand the password over once. It is not recoverable afterwards, only replaceable — there is no reset email.'}
            </p>
            {users?.length === 0 && (
              <p className="fine">
                {L ? 'Aucun accès pour ce client.' : 'No logins for this client yet.'}
              </p>
            )}
            <div className="org-list">
              {(users ?? []).map((u) => (
                <div key={u.username} className="org-row">
                  <span className="mono">{u.username}</span>
                  <span className="muted">
                    {u.disabled
                      ? L ? 'désactivé' : 'disabled'
                      : u.last_seen
                        ? `${L ? 'vu le' : 'seen'} ${String(u.last_seen).slice(0, 10)}`
                        : L ? 'jamais connecté' : 'never signed in'}
                  </span>
                  <button className="link" onClick={() => resetPassword(u)}>
                    {L ? 'nouveau mot de passe' : 'new password'}
                  </button>
                  <button
                    className="link"
                    onClick={() =>
                      run(() => api.setUserDisabled(u.username, !u.disabled)).then(() =>
                        loadUsers(usersOrg)
                      )
                    }
                  >
                    {u.disabled ? (L ? 'réactiver' : 'enable') : L ? 'désactiver' : 'disable'}
                  </button>
                  <button
                    className="link"
                    onClick={() => {
                      const msg = L
                        ? `Supprimer l'accès « ${u.username} » ? Désactiver conserve la trace des lectures.`
                        : `Delete the login “${u.username}”? Disabling keeps its read history attached to a name.`
                      if (confirm(msg))
                        run(() => api.deleteUser(u.username)).then(() => loadUsers(usersOrg))
                    }}
                  >
                    {L ? 'supprimer' : 'delete'}
                  </button>
                </div>
              ))}
            </div>
            <form className="org-new" onSubmit={addUser}>
              <input
                placeholder={L ? 'identifiant' : 'username'}
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
              />
              <input
                placeholder={L ? 'mot de passe (10 caractères min.)' : 'password (10 chars min.)'}
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              />
              <button className="link" type="button" onClick={suggestPassword}>
                {L ? 'proposer' : 'suggest'}
              </button>
              <button disabled={busy}>{L ? 'créer' : 'create'}</button>
            </form>
          </div>
        )}
        {ctxOrg && (
          <div className="ctx">
            <div className="ctx-h">
              <span>
                {L ? 'contexte' : 'context'} · {ctxOrg}
              </span>
              <span className="ctx-v">
                {ctxMeta
                  ? `v${ctxMeta.version} · ${String(ctxMeta.updated_at).slice(0, 10)}`
                  : L
                    ? 'aucun — v1 à la première sauvegarde'
                    : 'none — v1 on first save'}
              </span>
            </div>
            <textarea
              className="ctx-t"
              value={ctxText}
              onChange={(e) => setCtxText(e.target.value)}
              spellCheck={false}
              rows={10}
            />
            <p className="hint">
              {L
                ? 'ignore_sheets : feuilles jamais lues · units : en-tête → unité (USD, CDF, t, ha, pct…) · aliases : libellé → libellé canonique · exclude_labels : lignes de totaux à écarter. Chaque sauvegarde crée une version — rien ne s’écrase.'
                : 'ignore_sheets: sheets never read · units: header → unit (USD, CDF, t, ha, pct…) · aliases: label → canonical label · exclude_labels: total rows to drop. Every save creates a version — nothing is overwritten.'}
            </p>
            {ctxErr && <div className="note">{ctxErr}</div>}
            <div className="row-actions">
              <button className="gold-btn" onClick={saveContext} disabled={busy}>
                {L ? 'sauvegarder' : 'save'}
              </button>
            </div>
          </div>
        )}
        <form className="org-form" onSubmit={addOrg}>
          <input
            placeholder={L ? 'identifiant (pvak)' : 'id (pvak)'}
            value={newOrg.id}
            onChange={(e) => setNewOrg({ ...newOrg, id: e.target.value })}
            required
          />
          <input
            placeholder={L ? 'nom (PVAK)' : 'name (PVAK)'}
            value={newOrg.name}
            onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
            required
          />
          <input
            placeholder={L ? 'lieu (Mwebe, RDC)' : 'location (Mwebe, DRC)'}
            value={newOrg.sub}
            onChange={(e) => setNewOrg({ ...newOrg, sub: e.target.value })}
          />
          <button type="submit" disabled={busy}>
            {L ? 'créer' : 'create'}
          </button>
        </form>
      </section>
      </div>
    </div>
  )
}
