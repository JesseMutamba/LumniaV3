import { useEffect, useState } from 'react'
import * as api from '../lib/api.js'
import { t } from '../lib/format.js'

/**
 * What a signed-in client sees: their reports, and nothing else.
 *
 * The list is the same one the portal serves, but reached by session rather
 * than by key — so no key lands in the address bar, the browser history, or
 * whatever the client pastes into a group chat by accident.
 */
export default function ClientHome({ session, locale, onSignOut }) {
  const [reports, setReports] = useState(null)
  const [err, setErr] = useState(null)
  const L = locale === 'fr'

  useEffect(() => {
    api
      .myReports()
      .then(setReports)
      .catch((e) => {
        // A session that has been disabled or has expired since load: send
        // them back to the front door rather than showing an empty list.
        if (e.status === 401) onSignOut()
        else setErr(e)
      })
  }, [])

  return (
    <div className="doc inst">
      <div className="rep-head">
        <h1>{session.org.name}</h1>
        <div className="meta">
          <span className="chip">{t(session.org.sub, locale)}</span>
          <span className="chip">{session.user.username}</span>
          <button className="link ch-out" onClick={onSignOut}>
            {L ? 'se déconnecter' : 'sign out'}
          </button>
        </div>
      </div>

      <div className="b-label">{L ? 'Vos rapports' : 'Your reports'}</div>

      {err && (
        <p className="b-prose">
          {L
            ? "Les rapports n'ont pas pu être chargés. Réessayez dans un instant."
            : 'Your reports could not be loaded. Try again in a moment.'}
        </p>
      )}

      {reports?.length === 0 && (
        <p className="b-prose">
          {L
            ? 'Aucun rapport publié pour le moment. Le premier apparaîtra ici dès sa publication.'
            : 'No reports published yet. The first one will appear here the moment it is.'}
        </p>
      )}

      {reports === null && !err && <div className="skel">…</div>}

      <div className="pl">
        {(reports ?? []).map((r) => (
          <a key={r.id} className="pl-row" href={`#/m/${r.id}`}>
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
