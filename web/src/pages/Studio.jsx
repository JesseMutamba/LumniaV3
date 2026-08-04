import { useEffect, useState } from 'react'
import * as api from '../lib/api.js'
import Block from '../blocks/index.jsx'
import { t } from '../lib/format.js'

/**
 * Studio — the author's side of the platform.
 *
 * One job: get a report document into the platform and get a link out. It is
 * deliberately not an editor. You build the document elsewhere, where the
 * numbers and their cell addresses come from; Studio validates it, stores it,
 * and hands you a URL to send.
 */
export default function Studio({ locale, onPublished }) {
  const [orgs, setOrgs] = useState([])
  const [token, setTok] = useState(api.getToken())
  const [busy, setBusy] = useState(false)
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

  useEffect(() => {
    setReads(null)
    if (result) api.reportReads(result.id).then(setReads).catch(() => {})
  }, [result])
  const [newOrg, setNewOrg] = useState({ id: '', name: '', sub: '' })

  const [dash, setDash] = useState([])
  const [tlOrg, setTlOrg] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [q, setQ] = useState('')
  const [qOrg, setQOrg] = useState('')
  const [qMode, setQMode] = useState('direct')
  const [answer, setAnswer] = useState(null)
  const [tiles, setTiles] = useState(null)

  const loadTiles = (org) => {
    if (org) api.getTiles(org).then(setTiles).catch(() => setTiles(null))
  }
  useEffect(() => { loadTiles(qOrg) }, [qOrg])

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
    if (a) setAnswer(a)
  }

  async function runPlan() {
    const a = await run(() =>
      api.ask({
        org: qOrg || orgs[0]?.id,
        question: answer.question,
        mode: 'analyze',
        execute: true,
        plan: answer.plan,
      })
    )
    if (a) setAnswer(a)
  }

  async function openTimeline(id) {
    if (tlOrg === id) {
      setTlOrg(null)
      return
    }
    setTlOrg(id)
    setTimeline([])
    api.getTimeline(id).then(setTimeline).catch(() => {})
  }

  const L = locale === 'fr'
  const refresh = () => {
    if (api.hasToken()) {
      api
        .listStudioOrgs()
        .then((os) => {
          setOrgs(os)
          setQOrg((cur) => cur || os[0]?.id || '')
        })
        .catch(() => {})
      api.getDashboard().then(setDash).catch(() => {})
    }
  }
  useEffect(() => { refresh() }, [token])

  function saveToken(v) {
    api.setToken(v.trim())
    setTok(v.trim())
    setErr(null)
  }

  async function run(fn) {
    setBusy(true)
    setErr(null)
    try {
      return await fn()
    } catch (e) {
      setErr(e.detail ?? e.message)
      return null
    } finally {
      setBusy(false)
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
    const rep = await run(() => api.importReport(f))
    if (rep) {
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
    const r = await run(() => api.ingestWorkbook(fs, orgs[0]?.id))
    if (r) setInv(r)
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

  async function openContext(o) {
    if (ctxOrg === o.id) {
      setCtxOrg(null)
      return
    }
    setCtxOrg(o.id)
    setCtxErr(null)
    const c = await run(() => api.getOrgContext(o.id))
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
    const c = await run(() => api.saveOrgContext(ctxOrg, body))
    if (c) {
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
    const rep = await run(() => api.rotateKey(result.id))
    if (rep) {
      setResult(rep)
      setCopied(false)
    }
  }

  function copy() {
    navigator.clipboard.writeText(api.shareUrl(result))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
    <div className="studio">
      <div className="studio-h">
        <h2>Studio</h2>
        <button className="link" onClick={() => saveToken('')}>
          {L ? 'oublier le jeton' : 'forget token'}
        </button>
      </div>

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
          <select value={qOrg} onChange={(e) => setQOrg(e.target.value)}>
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
                  <Block b={t.block} locale={locale} sources={tiles.sources} />
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
          <input type="file" accept=".xlsx,.xlsm" multiple onChange={analyse} hidden />
          {busy
            ? L ? 'Analyse…' : 'Analysing…'
            : L ? 'Choisir un ou des classeurs .xlsx' : 'Choose .xlsx workbook(s)'}
        </label>
        {inv && (
          <div className="det">
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
                <button className="drop det-dl" onClick={downloadDraft}>
                  {L ? 'télécharger le brouillon .json' : 'download the draft .json'}
                </button>
                <p className="fine">
                  {L
                    ? 'Relisez le brouillon — intitulés, unités, lignes — puis publiez-le au panneau 03.'
                    : 'Review the draft — labels, units, rows — then publish it in panel 03.'}
                </p>
              </>
            )}
          </div>
        )}
      </section>

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
          <div className="panel-h">{L ? '04 · Lien à partager' : '04 · Share link'}</div>
          <div className="pub-title">
            {t(result.title, locale)} · {t(result.period.label, locale)} ·{' '}
            <span className="mono">{result.status}</span>
          </div>
          <div className="share">
            <code>{api.shareUrl(result)}</code>
            <button onClick={copy}>{copied ? (L ? 'copié' : 'copied') : L ? 'copier' : 'copy'}</button>
          </div>
          <p className="fine">
            {L
              ? "Quiconque a ce lien peut lire ce rapport et rien d'autre. Aucun compte requis."
              : 'Anyone with this link can read this one report and nothing else. No account required.'}
          </p>
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
              onClick={() => run(() => api.setStatus(result.id, 'retracted')).then(refresh)}
            >
              {L ? 'retirer le rapport' : 'retract report'}
            </button>
          </div>
        </section>
      )}

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
                <button
                  className="link"
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
              </div>
            ))}
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
  )
}
