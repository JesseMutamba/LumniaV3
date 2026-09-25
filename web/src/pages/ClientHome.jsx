import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, ChartNoAxesCombined, FileText, LoaderCircle, LogOut, RotateCcw, Trash2 } from 'lucide-react'
import { LumniaLogo } from '../components/branding/LumniaBrand'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/financial/ui.jsx'
import { createPublicationRequest, publicationApiBase } from '../lib/review-publication-api.js'
import * as api from '../lib/api.js'
import { t } from '../lib/format.js'
import '../components/studio/studio.css'
import '../components/financial/financial-review.css'
import './client-reports.css'

export default function ClientHome({ session, locale, onSignOut, onLocaleChange }) {
  const [reports, setReports] = useState([])
  const [published, setPublished] = useState([])
  const [trashed, setTrashed] = useState([])
  const [tab, setTab] = useState('published')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [action, setAction] = useState(null)
  const [actionError, setActionError] = useState('')
  const [actionConflict, setActionConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const scope = session.org.id + ':' + session.token
  const activeScope = useRef(scope)
  activeScope.current = scope
  useEffect(() => { setAction(null); setActionError(''); setActionConflict(false); setBusy(false); setNotice('') }, [scope])
  const L = locale === 'fr'
  const request = useMemo(() => createPublicationRequest({ org: session.org.id, onExpired: onSignOut }), [session.org.id, session.token])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    // Never display another account's cached list after a partial refresh failure.
    setReports([])
    setPublished([])
    setTrashed([])
    Promise.allSettled([api.myReports(), request(publicationApiBase), request(publicationApiBase + '?status=trashed')]).then(results => {
      if (!active) return
      const setters = [setReports, setPublished, setTrashed]
      results.forEach((result, index) => { if (result.status === 'fulfilled') setters[index](result.value) })
      if (results.some(result => result.status === 'rejected' && result.reason?.status === 401)) onSignOut()
      else if (results.some(result => result.status === 'rejected')) setError(L ? 'Certains rapports n’ont pas pu être chargés. Réessayez pour actualiser la liste.' : 'Some reports couldn’t be loaded. Retry to refresh the complete list.')
      setLoading(false)
    })
    return () => { active = false }
  }, [request, session.token, attempt])

  function confirm(report, kind) { setActionError(''); setActionConflict(false); setAction({ report, kind }) }
  async function applyAction() {
    if (!action || busy || actionConflict) return
    setBusy(true)
    setActionError('')
    const operationScope = scope
    const { report, kind } = action
    try {
      const url = publicationApiBase + '/' + encodeURIComponent(report.id)
      const value = kind === 'delete'
        ? await request(url + '?expected_version=' + report.version, { method: 'DELETE' })
        : await request(url + '/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_version: report.version }) })
      if (activeScope.current !== operationScope) return
      setPublished(items => kind === 'restore' ? [value, ...items.filter(item => item.id !== report.id)] : items.filter(item => item.id !== report.id))
      setTrashed(items => kind === 'trash' ? [value, ...items.filter(item => item.id !== report.id)] : items.filter(item => item.id !== report.id))
      setNotice(kind === 'delete' ? (L ? 'Rapport supprimé. L’analyse enregistrée est conservée dans Studio.' : 'Report permanently deleted. Your saved review remains in Studio.') : kind === 'trash' ? (L ? 'Rapport déplacé dans la corbeille.' : 'Report moved to Trash. You can restore it anytime.') : (L ? 'Rapport restauré dans les rapports publiés.' : 'Report restored to Published reports.'))
      setAction(null)
    } catch (error) {
      if (activeScope.current !== operationScope) return
      setActionError(error.status === 409 ? (L ? 'Ce rapport a changé dans une autre session. Fermez cette fenêtre et actualisez la liste.' : 'This report changed in another session. Close this dialog and refresh the list before trying again.') : error.message)
      if (error.status === 409) { setActionConflict(true); setAttempt(value => value + 1) }
    } finally { if (activeScope.current === operationScope) setBusy(false) }
  }
  const date = value => {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString(L ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const ownReports = tab === 'published' ? published : trashed
  const empty = ownReports.length === 0 && (tab === 'trashed' || reports.length === 0)
  const actionTitle = action?.kind === 'delete' ? (L ? 'Supprimer définitivement ce rapport ?' : 'Permanently delete this report?') : action?.kind === 'restore' ? (L ? 'Restaurer ce rapport ?' : 'Restore this report?') : (L ? 'Déplacer ce rapport dans la corbeille ?' : 'Move this report to Trash?')

  return <div className="gs-root cr-root">
    <aside className="gs-sidebar">
      <a className="gs-brand" href="#/analysis" aria-label="Lumnia Analytics Studio"><LumniaLogo /></a>
      <div className="gs-space"><div className="gs-avatar">{session.org.name?.[0] || 'L'}</div><div><strong>{session.org.name}</strong><small>{L ? 'Espace client' : 'Client workspace'}</small></div></div>
      <div className="gs-nav-label">{L ? 'Espace de travail' : 'Workspace'}</div>
      <a className="gs-nav" href="#/analysis"><ChartNoAxesCombined size={18} />Analytics Studio</a>
      <a className="gs-nav active" href="#/reports" aria-current="page"><FileText size={18} />{L ? 'Rapports publiés' : 'Published reports'}</a>
      <div className="gs-sidebar-bottom"><button className="gs-nav" type="button" onClick={onSignOut}><LogOut size={18} />{L ? 'Se déconnecter' : 'Sign out'}</button></div>
    </aside>
    <main className="gs-main">
      <header className="gs-topbar cr-topbar"><a href="#/analysis">← Analytics Studio</a><div className="cr-account"><span>{session.user.username}</span>{onLocaleChange && <select aria-label="Language" value={locale} onChange={event => onLocaleChange(event.target.value)}><option value="en">EN</option><option value="fr">FR</option></select>}<button type="button" className="cr-mobile-signout" onClick={onSignOut}>{L ? 'Se déconnecter' : 'Sign out'}</button></div></header>
      <div className="gs-heading"><div><span className="gs-eyebrow">{session.org.name}</span><h1>{L ? 'Vos rapports' : 'Your reports'}</h1><p>{L ? 'Vos revues publiées et les rapports partagés avec vous. Les analyses modifiables restent dans Studio.' : 'Your published reviews and reports shared with you. Editable analyses stay in Studio.'}</p></div><a className="cr-open-studio" href="#/analysis">{L ? 'Ouvrir Studio' : 'Open Studio'}<ArrowUpRight size={17} /></a></div>
      <section className="cr-reports" aria-label={L ? 'Rapports' : 'Reports'} aria-busy={loading}>
        <div className="cr-toolbar"><div className="cr-filters" role="group" aria-label={L ? 'Statut des rapports' : 'Report status'}><button type="button" aria-pressed={tab === 'published'} onClick={() => { setTab('published'); setNotice('') }}><FileText size={16}/>{L ? 'Publiés' : 'Published'}<span>{published.length + reports.length}</span></button><button type="button" aria-pressed={tab === 'trashed'} onClick={() => { setTab('trashed'); setNotice('') }}><Trash2 size={16}/>{L ? 'Corbeille' : 'Trash'}<span>{trashed.length}</span></button></div><button className="cr-refresh" type="button" disabled={loading || busy} onClick={() => setAttempt(value => value + 1)}><RotateCcw size={16}/>{L ? 'Actualiser' : 'Refresh'}</button></div>
        {notice && <p className="cr-notice" role="status">{notice}</p>}
        {error && <div className="cr-error" role="alert"><p>{error}</p><button type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)}>{L ? 'Réessayer' : 'Retry'}</button></div>}
        {loading ? <div className="cr-empty" role="status"><LoaderCircle className="ws-spin" size={24} /><p>{L ? 'Chargement des rapports…' : 'Loading your reports…'}</p></div> : empty && !error ? <div className="cr-empty">{tab === 'trashed' ? <Trash2 size={32}/> : <FileText size={32} />}<h2>{tab === 'trashed' ? (L ? 'La corbeille est vide' : 'Trash is empty') : (L ? 'Publiez votre première revue' : 'Publish your first review')}</h2><p>{tab === 'trashed' ? (L ? 'Les rapports déplacés dans la corbeille peuvent être restaurés ou supprimés définitivement.' : 'Reports moved to Trash can be restored or permanently deleted here.') : (L ? 'Ouvrez une revue financière dans Studio, puis sélectionnez Publier. Elle apparaîtra ici avec ses sept onglets et ses hypothèses.' : 'Open a financial review in Studio and select Publish. Its tabs, insights and saved assumptions will appear here.')}</p>{tab === 'published' && <a href="#/analysis">{L ? 'Ouvrir Studio' : 'Open Studio'}<ArrowUpRight size={16}/></a>}</div> : <div className="cr-report-list">
          {ownReports.map(report => <article key={report.id} className="cr-report"><span className="cr-report-icon"><FileText size={23}/></span><div className="cr-report-detail"><span className="cr-type">{L ? 'Revue financière' : 'Financial review'}</span><h2>{tab === 'published' ? <a href={`#/published/${encodeURIComponent(report.id)}`}>{report.title}</a> : report.title}</h2><small>{tab === 'trashed' ? (L ? 'Mis à la corbeille le ' : 'Trashed ') + date(report.trashed_at) : (L ? 'Publié le ' : 'Published ') + date(report.published_at)} · {L ? 'Version de la revue' : 'Review version'} {report.source_version}</small></div><div className="cr-report-actions">{tab === 'published' ? <><a href={`#/published/${encodeURIComponent(report.id)}`} aria-label={(L ? 'Ouvrir ' : 'Open ') + report.title}>{L ? 'Ouvrir' : 'Open'}<ArrowUpRight size={16}/></a><button type="button" disabled={busy} onClick={() => confirm(report, 'trash')} aria-label={(L ? 'Mettre à la corbeille : ' : 'Move to Trash: ') + report.title}><Trash2 size={16}/>{L ? 'Corbeille' : 'Trash'}</button></> : <><button type="button" disabled={busy} onClick={() => confirm(report, 'restore')} aria-label={(L ? 'Restaurer : ' : 'Restore: ') + report.title}><RotateCcw size={16}/>{L ? 'Restaurer' : 'Restore'}</button><button className="cr-danger" type="button" disabled={busy} onClick={() => confirm(report, 'delete')} aria-label={(L ? 'Supprimer définitivement : ' : 'Permanently delete: ') + report.title}><Trash2 size={16}/>{L ? 'Supprimer définitivement' : 'Delete permanently'}</button></>}</div></article>)}
          {tab === 'published' && reports.map(report => <article key={'shared:' + report.id} className="cr-report"><span className="cr-report-icon"><FileText size={23}/></span><div className="cr-report-detail"><span className="cr-type">{L ? 'Rapport partagé · lecture seule' : 'Shared report · view only'}</span><h2><a href={`#/m/${encodeURIComponent(report.id)}`}>{t(report.title, locale)}</a></h2><small>{t(report.period?.label, locale)}{report.generated_at ? ' · ' + date(report.generated_at) : ''}</small></div><div className="cr-report-actions"><a href={`#/m/${encodeURIComponent(report.id)}`} aria-label={(L ? 'Ouvrir ' : 'Open ') + t(report.title, locale)}>{L ? 'Ouvrir' : 'Open'}<ArrowUpRight size={16}/></a></div></article>)}
        </div>}
      </section>
    </main>
    <Dialog open={!!action} onOpenChange={open => { if (!open && !busy) setAction(null) }}><DialogContent showCloseButton={!busy} onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onPointerDownOutside={event => { if (busy) event.preventDefault() }}><DialogHeader><DialogTitle>{actionTitle}</DialogTitle><DialogDescription>{action?.kind === 'delete' ? (L ? 'Cette action est irréversible. Seule cette publication sera supprimée ; votre analyse enregistrée restera dans Studio.' : 'This cannot be undone. Only this published snapshot will be deleted; your saved review will remain in Studio.') : action?.kind === 'restore' ? (L ? 'Ce rapport réapparaîtra dans vos rapports publiés, avec ses hypothèses d’origine.' : 'This report will return to Published with its original saved assumptions.') : (L ? 'Ce rapport sera masqué de la liste des publications. Vous pourrez le restaurer depuis la corbeille. Votre analyse enregistrée sera conservée.' : 'This report will leave the Published list. You can restore it from Trash. Your saved review stays in Studio.')}</DialogDescription></DialogHeader><p className="cr-confirm-title">{action?.report.title}</p>{actionError && <p className="cr-error" role="alert">{actionError}</p>}<div className="cr-dialog-actions"><Button variant="outline" disabled={busy} onClick={() => setAction(null)}>{L ? 'Annuler' : 'Cancel'}</Button><Button className={action?.kind === 'delete' ? 'cr-delete-confirm' : ''} disabled={busy || actionConflict} onClick={applyAction}>{busy ? <><LoaderCircle className="ws-spin" size={16}/>{L ? 'Mise à jour…' : 'Updating…'}</> : action?.kind === 'delete' ? (L ? 'Supprimer définitivement' : 'Delete permanently') : action?.kind === 'restore' ? (L ? 'Restaurer le rapport' : 'Restore report') : (L ? 'Mettre à la corbeille' : 'Move to Trash')}</Button></div></DialogContent></Dialog>
  </div>
}
