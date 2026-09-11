import { useEffect, useState } from 'react'
import { ArrowUpRight, ChartNoAxesCombined, FileText, LoaderCircle, LogOut } from 'lucide-react'
import { LumniaLogo } from '../components/branding/LumniaBrand'
import * as api from '../lib/api.js'
import { t } from '../lib/format.js'
import '../components/studio/studio.css'
import '../components/financial/financial-review.css'
import './client-reports.css'

export default function ClientHome({ session, locale, onSignOut, onLocaleChange }) {
  const [reports, setReports] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const L = locale === 'fr'
  useEffect(() => {
    let active = true
    setError('')
    api.myReports().then(value => { if (active) setReports(value) }).catch(error => {
      if (!active) return
      if (error.status === 401) onSignOut()
      else setError(L ? 'Les rapports ne sont pas disponibles. Réessayez.' : 'Your reports couldn’t be loaded. Please try again.')
    })
    return () => { active = false }
  }, [session.token, attempt])

  return <div className="gs-root cr-root">
    <aside className="gs-sidebar">
      <a className="gs-brand" href="#/analysis"><LumniaLogo /></a>
      <div className="gs-space"><div className="gs-avatar">{session.org.name?.[0] || 'L'}</div><div><strong>{session.org.name}</strong><small>{L ? 'Espace client' : 'Client workspace'}</small></div></div>
      <div className="gs-nav-label">{L ? 'Espace de travail' : 'Workspace'}</div>
      <a className="gs-nav" href="#/analysis"><ChartNoAxesCombined size={18} />Analytics Studio</a>
      <a className="gs-nav active" href="#/reports" aria-current="page"><FileText size={18} />{L ? 'Rapports publiés' : 'Published reports'}</a>
      <div className="gs-sidebar-bottom"><button className="gs-nav" type="button" onClick={onSignOut}><LogOut size={18} />{L ? 'Se déconnecter' : 'Sign out'}</button></div>
    </aside>
    <main className="gs-main">
      <header className="gs-topbar cr-topbar"><a href="#/analysis">← Analytics Studio</a><div className="cr-account"><span>{session.user.username}</span>{onLocaleChange && <select aria-label="Language" value={locale} onChange={event => onLocaleChange(event.target.value)}><option value="en">EN</option><option value="fr">FR</option></select>}<button type="button" className="cr-mobile-signout" onClick={onSignOut}>{L ? 'Se déconnecter' : 'Sign out'}</button></div></header>
      <div className="gs-heading"><div><span className="gs-eyebrow">{session.org.name}</span><h1>{L ? 'Vos rapports publiés' : 'Your published reports'}</h1><p>{L ? 'Les rapports partagés avec vous. Vos analyses enregistrées restent dans Analytics Studio.' : 'Reports shared with you. Your saved analyses stay in Analytics Studio.'}</p></div><a className="cr-open-studio" href="#/analysis">{L ? 'Ouvrir Studio' : 'Open Studio'}<ArrowUpRight size={17} /></a></div>
      <section className="cr-reports" aria-label={L ? 'Rapports' : 'Reports'}>
        {error ? <div className="cr-empty" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>{L ? 'Réessayer' : 'Try again'}</button></div> : reports === null ? <div className="cr-empty" role="status"><LoaderCircle className="ws-spin" size={24} /><p>{L ? 'Chargement des rapports…' : 'Loading your reports…'}</p></div> : reports.length === 0 ? <div className="cr-empty"><FileText size={32} /><h2>{L ? 'Vos rapports apparaîtront ici' : 'Your reports will appear here'}</h2><p>{L ? 'Vous pouvez déjà charger vos fichiers et créer une analyse dans Studio.' : 'You can already upload your files and create an analysis in Studio.'}</p><a href="#/analysis">{L ? 'Analyser vos données' : 'Analyze your data'}<ArrowUpRight size={16}/></a></div> : <div className="cr-report-list">{reports.map(report => <a key={report.id} className="cr-report" href={`#/m/${encodeURIComponent(report.id)}`}><span className="cr-report-icon"><FileText size={23}/></span><span><strong>{t(report.title, locale)}</strong><small>{t(report.period?.label, locale)}{report.generated_at ? ' · ' + String(report.generated_at).slice(0, 10) : ''}</small></span><ArrowUpRight size={20}/></a>)}</div>}
      </section>
    </main>
  </div>
}
