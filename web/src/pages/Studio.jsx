import { useEffect, useState } from 'react'
import * as api from '../lib/api.js'
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
  const [newOrg, setNewOrg] = useState({ id: '', name: '', sub: '' })

  const L = locale === 'fr'
  const refresh = () => {
    if (api.hasToken()) api.listStudioOrgs().then(setOrgs).catch(() => {})
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
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const r = await run(() => api.ingestWorkbook(f, orgs[0]?.id))
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

      {/* ---------------------------------------------------------- analyse */}
      <section className="panel">
        <div className="panel-h">
          {L ? '01 · Analyser un classeur' : '01 · Analyse a workbook'}
        </div>
        <p>
          {L
            ? 'Déposez un classeur (.xlsx). La machine détecte les tableaux, écrit un brouillon de rapport où chaque valeur porte déjà sa cellule source, et vous le rend pour relecture.'
            : 'Drop a workbook (.xlsx). The machine detects the tables, writes a draft report in which every value already carries its source cell, and hands it back for review.'}
        </p>
        <label className="drop">
          <input type="file" accept=".xlsx,.xlsm" onChange={analyse} hidden />
          {busy
            ? L ? 'Analyse…' : 'Analysing…'
            : L ? 'Choisir un classeur .xlsx' : 'Choose an .xlsx workbook'}
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
            {inv.draft && (
              <>
                <button className="drop det-dl" onClick={downloadDraft}>
                  {L ? 'télécharger le brouillon .json' : 'download the draft .json'}
                </button>
                <p className="fine">
                  {L
                    ? 'Relisez le brouillon — intitulés, unités, lignes — puis publiez-le au panneau 02.'
                    : 'Review the draft — labels, units, rows — then publish it in panel 02.'}
                </p>
              </>
            )}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- publish */}
      <section className="panel">
        <div className="panel-h">
          {L ? '02 · Publier un rapport' : '02 · Publish a report'}
        </div>
        <p>
          {L
            ? 'Déposez un document de rapport (.json). Il est validé contre le schéma et contre CH-004 — toute valeur sans cellule source est refusée avant enregistrement.'
            : 'Drop a report document (.json). It is validated against the schema and against CH-004 — any value without a source cell is refused before it is stored.'}
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
          <div className="panel-h">{L ? '03 · Lien à partager' : '03 · Share link'}</div>
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
        <div className="panel-h">{L ? '04 · Clients' : '04 · Clients'}</div>
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
