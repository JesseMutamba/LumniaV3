import { useEffect, useState } from 'react'
import Block from './blocks/index.jsx'
import Studio from './pages/Studio.jsx'
import * as api from './lib/api.js'
import { t } from './lib/format.js'

/**
 * Two surfaces, one build.
 *
 *   #/r/<id>?k=<key>   Viewer — what a stakeholder opens. Read only, no nav,
 *                              no upload, no sign of the rest of the platform.
 *   #/studio           Studio — what you open. Publish, share, retract.
 *
 * A reader never reaches Studio because a reader never has the token, and a
 * report they hold no key for returns 404. Nothing sensitive ships in the
 * bundle because the bundle holds nothing worth having.
 */
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/'
  const [path, qs] = raw.split('?')
  const q = new URLSearchParams(qs || '')
  const m = path.match(/^\/r\/([^/?]+)/)
  if (m) return { view: 'report', id: decodeURIComponent(m[1]), key: q.get('k') }
  if (path.startsWith('/studio')) return { view: 'studio' }
  return { view: 'home' }
}

export default function App() {
  const [route, setRoute] = useState(parseHash)
  const [locale, setLocale] = useState('fr')

  useEffect(() => {
    const on = () => setRoute(parseHash())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])

  return (
    <div className="shell">
      <div className="top">
        <a className="brand" href="#/">
          <span className="dot" />
          Lumnia
        </a>
        <div className="grow" />
        {route.view !== 'report' && (
          <a className="tbtn" href={route.view === 'studio' ? '#/' : '#/studio'}>
            {route.view === 'studio' ? (locale === 'fr' ? 'accueil' : 'home') : 'studio'}
          </a>
        )}
        <div className="lang" role="group" aria-label="Locale">
          {['fr', 'en'].map((l) => (
            <button key={l} aria-pressed={locale === l} onClick={() => setLocale(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {route.view === 'report' && (
        <Viewer id={route.id} shareKey={route.key} locale={locale} />
      )}
      {route.view === 'studio' && <Studio locale={locale} />}
      {route.view === 'home' && <Home locale={locale} />}
    </div>
  )
}

/* ------------------------------------------------------------------ home */

function Home({ locale }) {
  const [h, setH] = useState(null)
  useEffect(() => {
    api.health().then(setH).catch(() => setH({ ok: false }))
  }, [])
  const L = locale === 'fr'
  return (
    <div className="home">
      <h1>
        {L ? 'Intelligence opérationnelle vérifiée' : 'Verified operating intelligence'}
      </h1>
      <p>
        {L
          ? "Chaque chiffre publié ici porte l'adresse de la cellule dont il provient. Un rapport s'ouvre avec le lien que vous avez reçu."
          : 'Every figure published here carries the address of the cell it came from. A report opens with the link you were sent.'}
      </p>
      <div className="status">
        {h?.ok ? (
          <>
            <span className="ok">●</span> API {h.version} · {h.orgs}{' '}
            {L ? 'clients' : 'clients'} · {h.reports} {L ? 'rapports' : 'reports'}
            {!h.publishing_enabled && (
              <span className="warn">
                {' '}
                · {L ? 'publication désactivée' : 'publishing disabled'}
              </span>
            )}
          </>
        ) : (
          <span className="warn">● {L ? "l'API ne répond pas" : 'API not responding'}</span>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- viewer */

function Viewer({ id, shareKey, locale }) {
  const [rep, setRep] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    setRep(null)
    setErr(null)
    api.getReport(id, shareKey).then(setRep).catch(setErr)
  }, [id, shareKey])

  const L = locale === 'fr'

  if (err)
    return (
      <div className="doc">
        <div className="gone">
          <div className="ic">⌖</div>
          <h2>
            {err.status === 410
              ? L
                ? 'Ce rapport a été retiré'
                : 'This report has been withdrawn'
              : L
                ? 'Lien introuvable ou expiré'
                : 'Link not found or expired'}
          </h2>
          <p>
            {err.status === 410
              ? L
                ? "Un chiffre s'est révélé faux. Demandez la version corrigée."
                : 'A figure turned out to be wrong. Ask for the corrected version.'
              : L
                ? 'Vérifiez le lien complet, y compris la clé après « ?k= ».'
                : 'Check the full link, including the key after \u201c?k=\u201d.'}
          </p>
        </div>
      </div>
    )

  if (!rep) return <div className="doc skel">…</div>

  return (
    <div className="doc">
      <div className="rep-head">
        <h1>{t(rep.title, locale)}</h1>
        <div className="meta">
          <span className="chip">{t(rep.period.label, locale)}</span>
          {rep.status === 'draft' && <span className="chip draft">draft</span>}
          <span className="chip">
            {L ? 'généré le' : 'generated'} {String(rep.generated_at).slice(0, 10)}
          </span>
        </div>
      </div>

      {rep.blocks.map((b, i) => (
        <Block key={i} b={b} locale={locale} sources={rep.sources} />
      ))}

      <div className="foot">
        <div className="rule">
          {L
            ? "Le code calcule, le langage raconte. Aucun indicateur ne s'affiche sans provenance jusqu'à une cellule source."
            : 'Code computes, language narrates. No metric renders without provenance to a source cell.'}
        </div>
        Lumnia · pipeline {rep.pipeline_version}
      </div>
    </div>
  )
}
