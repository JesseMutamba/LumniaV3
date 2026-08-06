import { useEffect, useMemo, useState } from 'react'
import Block from './blocks/index.jsx'
import Studio from './pages/Studio.jsx'
import Dashboard, { hasDashboard } from './pages/Dashboard.jsx'
import Landing from './pages/Landing.jsx'
import ClientHome from './pages/ClientHome.jsx'
import * as api from './lib/api.js'
import { t } from './lib/format.js'
import mark from './assets/lumnia-mark.png'

/**
 * Four surfaces, one build.
 *
 *   /                  Landing — the public page, or the client's own reports
 *                              once they are signed in.
 *   #/r/<id>?k=<key>   Viewer — what a stakeholder opens with a link. Read
 *                              only, no nav, no sign of the rest of the platform.
 *   #/m/<id>           The same report opened by a signed-in client: the
 *                              session says who they are, so no key rides
 *                              along in the URL or the browser history.
 *   #/studio           Studio — what you open. Publish, share, retract.
 *
 * A reader never reaches Studio because a reader never has the author token,
 * and a report they hold neither key nor session for returns 404. Nothing
 * sensitive ships in the bundle because the bundle holds nothing worth having.
 */
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/'
  const [path, qs] = raw.split('?')
  const q = new URLSearchParams(qs || '')
  const m = path.match(/^\/r\/([^/?]+)/)
  if (m) return { view: 'report', id: decodeURIComponent(m[1]), key: q.get('k') }
  const mine = path.match(/^\/m\/([^/?]+)/)
  if (mine) return { view: 'myreport', id: decodeURIComponent(mine[1]) }
  const c = path.match(/^\/c\/([^/?]+)/)
  if (c) return { view: 'portal', id: decodeURIComponent(c[1]), key: q.get('k') }
  if (path.startsWith('/studio')) return { view: 'studio' }
  return { view: 'home' }
}

/**
 * English is the platform's language. A reader who switches keeps their
 * choice — PVAK's stakeholders read French, and being flipped back on every
 * visit is the kind of small rudeness that makes a tool feel foreign.
 */
const LOCALE_KEY = 'lumnia.locale'
const firstLocale = () => {
  try {
    const saved = localStorage.getItem(LOCALE_KEY)
    if (saved === 'fr' || saved === 'en') return saved
  } catch {
    // private browsing denies storage; the default is still right
  }
  return 'en'
}

export default function App() {
  const [route, setRoute] = useState(parseHash)
  const [locale, setLocale] = useState(firstLocale)
  const [session, setSess] = useState(api.getSession)

  async function signIn(username, password) {
    const s = await api.login(username, password)
    api.setSession(s)
    setSess(s)
    location.hash = '#/'
  }

  function signOut() {
    api.setSession(null)
    setSess(null)
    location.hash = '#/'
  }

  const chooseLocale = (l) => {
    setLocale(l)
    try {
      localStorage.setItem(LOCALE_KEY, l)
    } catch {
      // nothing to do; the session still switches
    }
  }

  useEffect(() => {
    const on = () => setRoute(parseHash())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])

  // The page must tell the truth about its language, or Chrome's
  // auto-translate rewrites the report — filenames included.
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // The landing page brings its own nav and is written in English only, so
  // the platform bar — and a language toggle with nothing to toggle — would
  // be two headers arguing with each other.
  const bare = route.view === 'home' && !session
  // A cream document under a dark green bar is two designs meeting at a
  // hard edge. Reader surfaces get a header in their own key.
  const reading = ['report', 'myreport', 'portal'].includes(route.view) || !!session

  return (
    <div className="shell">
      {!bare && (
        <div className={`top${reading ? ' inst' : ''}`}>
          <a className="brand" href="#/">
            <img src={mark} alt="" />
            <span>Lumnia</span>
          </a>
          <div className="grow" />
          {route.view !== 'report' && route.view !== 'portal' && !session && (
            <a className="tbtn" href={route.view === 'studio' ? '#/' : '#/studio'}>
              {route.view === 'studio' ? (locale === 'fr' ? 'accueil' : 'home') : 'studio'}
            </a>
          )}
          <div className="lang" role="group" aria-label="Locale">
            {['fr', 'en'].map((l) => (
              <button key={l} aria-pressed={locale === l} onClick={() => chooseLocale(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {route.view === 'report' && (
        <Viewer id={route.id} shareKey={route.key} locale={locale} />
      )}
      {route.view === 'myreport' && (
        <Viewer id={route.id} mine locale={locale} onExpired={signOut} />
      )}
      {route.view === 'portal' && (
        <PortalPage id={route.id} shareKey={route.key} locale={locale} />
      )}
      {route.view === 'studio' && <Studio locale={locale} />}
      {route.view === 'home' &&
        (session ? (
          <ClientHome session={session} locale={locale} onSignOut={signOut} />
        ) : (
          <Landing onSignIn={signIn} />
        ))}
    </div>
  )
}

/* ---------------------------------------------------------------- portal */

function PortalPage({ id, shareKey, locale }) {
  const [portal, setPortal] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    setPortal(null)
    setErr(null)
    api.getPortal(id, shareKey).then(setPortal).catch(setErr)
  }, [id, shareKey])

  const L = locale === 'fr'

  if (err)
    return (
      <div className="doc inst">
        <div className="gone">
          <div className="ic">⌖</div>
          <h2>{L ? 'Lien introuvable ou expiré' : 'Link not found or expired'}</h2>
          <p>
            {L
              ? 'Vérifiez le lien complet, y compris la clé après « ?k= ».'
              : 'Check the full link, including the key after “?k=”.'}
          </p>
        </div>
      </div>
    )

  if (!portal) return <div className="doc inst skel">…</div>

  return (
    <div className="doc inst">
      <div className="rep-head">
        <h1>{portal.org.name}</h1>
        <div className="meta">
          <span className="chip">{t(portal.org.sub, locale)}</span>
        </div>
      </div>

      <div className="b-label">{L ? 'Rapports' : 'Reports'}</div>
      {portal.reports.length === 0 && (
        <p className="b-prose">
          {L
            ? 'Aucun rapport publié pour le moment. Celui-ci apparaîtra ici dès sa publication.'
            : 'No reports published yet. The first one will appear here the moment it is.'}
        </p>
      )}
      <div className="pl">
        {portal.reports.map((r) => (
          <a key={r.id} className="pl-row" href={`#/r/${r.id}?k=${r.share_key}`}>
            <span className="pl-t">{t(r.title, locale)}</span>
            <span className="pl-m">{t(r.period.label, locale)}</span>
            <span className="pl-m">{String(r.generated_at ?? '').slice(0, 10)}</span>
            <span className="pl-a">→</span>
          </a>
        ))}
      </div>

      <div className="foot">
        <div className="rule">
          {L
            ? "Chaque chiffre de ces rapports porte l'adresse de la cellule dont il provient."
            : 'Every figure in these reports carries the address of the cell it came from.'}
        </div>
        <div className="sig">Lumnia</div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- viewer */

function Viewer({ id, shareKey, mine = false, locale, onExpired }) {
  const [rep, setRep] = useState(null)
  const [err, setErr] = useState(null)
  const [lens, setLens] = useState('doc')

  useEffect(() => {
    setRep(null)
    setErr(null)
    setLens('doc')
    // Same document either way. What differs is who is asking: a key in the
    // link, or the session of a client who signed in.
    const load = mine ? api.getMyReport(id) : api.getReport(id, shareKey)
    load.then(setRep).catch((e) => {
      if (mine && e.status === 401) onExpired?.()
      else setErr(e)
    })
  }, [id, shareKey, mine])

  // Tabs, bookmarks and shared links deserve the report's name, not ours.
  useEffect(() => {
    if (rep) document.title = `${t(rep.title, locale)} · Lumnia`
    return () => {
      document.title = 'Lumnia'
    }
  }, [rep, locale])

  const L = locale === 'fr'

  // A long report is a document nobody finishes. Its own level-2 headings
  // are its sections, so they become the tabs — no extra structure to keep
  // in step, and a report written without headings still reads as one page.
  const tabs = useMemo(() => {
    if (!rep) return []
    const out = []
    for (const b of rep.blocks) {
      const isSection = b.type === 'heading' && (b.level ?? 2) <= 2
      if (b.type === 'ledger') {
        out.push({ key: 'src', label: L ? 'Sources' : 'Sources', blocks: [b] })
        continue
      }
      if (isSection || !out.length) {
        const label = isSection
          ? t(b.label, locale) || t(b.text, locale)
          : L ? 'Rapport' : 'Report'
        out.push({ key: `s${out.length}`, label, blocks: [] })
      }
      out[out.length - 1].blocks.push(b)
    }
    if (hasDashboard(rep)) {
      out.unshift({
        key: 'dash',
        label: L ? 'Tableau de bord' : 'Dashboard',
        blocks: [],
      })
    }
    return out
  }, [rep, locale, L])

  useEffect(() => {
    if (tabs.length) setLens(tabs[0].key)
  }, [rep])

  if (err)
    return (
      <div className="doc inst">
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

  if (!rep) return <div className="doc inst skel">…</div>

  return (
    <div className="doc inst">
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

      <div className="lens" role="tablist" aria-label={L ? 'Sections' : 'Sections'}>
        {tabs.map((tb) => (
          <button
            key={tb.key}
            role="tab"
            aria-selected={lens === tb.key}
            onClick={() => setLens(tb.key)}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {lens === 'dash' ? (
        <Dashboard rep={rep} locale={locale} />
      ) : (
        (tabs.find((tb) => tb.key === lens) || tabs[0]).blocks.map((b, i) => (
          <Block key={i} b={b} locale={locale} sources={rep.sources} />
        ))
      )}

      <div className="foot">
        <div className="rule">
          {L
            ? "Le code calcule, le langage raconte. Aucun indicateur ne s'affiche sans provenance jusqu'à une cellule source."
            : 'Code computes, language narrates. No metric renders without provenance to a source cell.'}
        </div>
        <div className="sig">Lumnia · pipeline {rep.pipeline_version}</div>
      </div>
    </div>
  )
}
