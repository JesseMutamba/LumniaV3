import { useEffect, useState } from 'react'
import FinancialReview from '../components/financial/FinancialReview'
import { createPublicFinancialExample, createPublicFinancialFiles } from '../lib/financial/public-example'
import { DEFAULT_DRIVERS, DEFAULT_RISK } from '../lib/financial/model'
import { FinancialDocument } from '../lib/financial/schema'
import { WorkspaceState } from './WorkspaceSignIn'

/** The production review component, with synthetic inputs and no persistence. */
export default function PublicDemo() {
  const [document, setDocument] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [downloadError, setDownloadError] = useState('')
  const [downloading, setDownloading] = useState(false)
  useEffect(() => {
    let active = true
    setDocument(null)
    setError('')
    createPublicFinancialExample().then(review => {
      const result = FinancialDocument.parse({
        title: review.title, review, drivers: { ...DEFAULT_DRIVERS },
        risk: { ...DEFAULT_RISK, year: review.comparisonYear }, tab: 'overview',
      })
      if (active) setDocument(result)
    }).catch(() => {
      if (active) setError('The example workbooks could not be prepared. Please try again.')
    })
    return () => { active = false }
  }, [attempt])
  useEffect(() => {
    window.document.title = 'Lumnia — Interactive financial dashboard'
    return () => { window.document.title = 'Lumnia Studio — Analytics' }
  }, [])
  async function downloadSource(index) {
    if (downloading) return
    setDownloading(true)
    setDownloadError('')
    try {
      const files = await createPublicFinancialFiles()
      const file = files[index]
      const url = URL.createObjectURL(file)
      const anchor = window.document.createElement('a')
      anchor.href = url
      anchor.download = file.name
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setDownloadError('This example workbook could not be downloaded. Please try again.') }
    finally { setDownloading(false) }
  }
  if (error) return <><WorkspaceState error={error} onRetry={() => setAttempt(value => value + 1)} /><p style={{textAlign:'center'}}><a href="/">Back to Lumnia</a></p></>
  if (!document) return <WorkspaceState message="Preparing the example workbooks…" />
  return <FinancialReview initialDocument={document} readOnly example resumeLastReview={false}
    workspaceName="Example workspace" studioHref="#/analysis" reportsHref="#/reports"
    exampleActions={<div className="fr-example-actions">
      <a href="#/analysis" className="fr-text-link">Analyze your own files ↗</a>
      <button className="fr-text-link" onClick={() => downloadSource(0)} disabled={downloading}>Download example plan</button>
      <button className="fr-text-link" onClick={() => downloadSource(1)} disabled={downloading}>Download example Q1 results</button>
      {downloadError && <p role="alert">{downloadError}</p>}
    </div>} />
}
