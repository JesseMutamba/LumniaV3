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
  const [newOrg, setNewOrg] = useState({ id: '', name: '', sub: '' })

  const L = locale === 'fr'
  const refresh = () => api.listOrgs().then(setOrgs).catch(() => {})
  useEffect(refresh, [])

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

      {/* ---------------------------------------------------------- publish */}
      <section className="panel">
        <div className="panel-h">
          {L ? '01 · Publier un rapport' : '01 · Publish a report'}
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
          <div className="panel-h">{L ? '02 · Lien à partager' : '02 · Share link'}</div>
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
        <div className="panel-h">{L ? '03 · Clients' : '03 · Clients'}</div>
        {orgs.length > 0 && (
          <div className="org-list">
            {orgs.map((o) => (
              <div key={o.id} className="org-row">
                <span className="mono">{o.id}</span>
                <span>{o.name}</span>
                <span className="muted">
                  {o.report_count} {L ? 'rapports' : 'reports'}
                </span>
              </div>
            ))}
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
