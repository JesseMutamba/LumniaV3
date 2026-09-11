import { useEffect, useMemo, useState } from 'react'
import FinancialReview from '../components/financial/FinancialReview'
import { FinancialDocument } from '../lib/financial/schema'
import { createPublicationRequest, publicationApiBase } from '../lib/review-publication-api.js'
import { WorkspaceState } from './WorkspaceSignIn.jsx'
import './client-reports.css'

export default function PublishedReview({ id, session, onExpired, onSignOut }) {
  const [publication, setPublication] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const request = useMemo(() => createPublicationRequest({ org: session.org.id, onExpired }), [session.org.id, session.token])
  useEffect(() => {
    let active = true
    setPublication(null)
    setError('')
    request(publicationApiBase + '/' + encodeURIComponent(id)).then(value => {
      if (!active) return
      if (value.status === 'trashed') setError('This report is in Trash. Restore it from Reports to open it again.')
      else {
        const parsed = FinancialDocument.safeParse({ title: value.title, review: value.review, drivers: value.drivers, risk: value.risk, tab: value.tab })
        if (!parsed.success) setError('This report could not be opened because its saved data is incomplete. Reopen the review in Studio and publish a new version.')
        else setPublication({ ...value, ...parsed.data })
      }
    }).catch(error => { if (active) setError(error.status === 404 ? 'This report is no longer available in your account.' : error.message) })
    return () => { active = false }
  }, [id, request, attempt])
  useEffect(() => {
    if (publication) document.title = `${publication.title} · Lumnia Reports`
    return () => { document.title = 'Lumnia Studio — Analytics' }
  }, [publication])
  if (error) return <div className="cr-view-error"><WorkspaceState error={error} onRetry={() => setAttempt(value => value + 1)} /><a className="cr-back-reports" href="#/reports">← Back to Reports</a></div>
  if (!publication) return <WorkspaceState message="Opening your published review…" />
  return <FinancialReview key={publication.id} initialDocument={publication} readOnly publication={{...publication,review_version:publication.source_version}} workspaceName={session.org.name} reportsHref="#/reports" publicationHref="#/reports" studioHref="#/analysis" onSignOut={onSignOut} />
}
