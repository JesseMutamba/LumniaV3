import { useEffect, useMemo, useRef, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import * as api from '../lib/api.js'
import { analyze, currenciesForMeasure, inferMapping, interpretRequest, money, viewLabels } from '../lib/analytics/analytics'
import { defaultMetric, financialAnalysis, interpretFinancial, metricFormat } from '../lib/analytics/financial'
import { compactSources } from '../lib/analytics/provenance'
import { sampleSalesFile } from '../lib/analytics/sample-sales'
import './analytics-workspace.css'

const updateUrl = url => { try { history.replaceState(null, '', url) } catch { /* Embeds may deny history access. */ } }
const query = () => new URLSearchParams(location.hash.split('?')[1] || '')
const emptyState = () => ({ id: null, version: null, title: '', dataset: null, mapping: null, views: [], messages: [] })
const frenchViews = { monthly: 'Revenus mensuels', quarterly: 'Revenus trimestriels', yearly: 'Revenus annuels', region: 'Revenus par région', product: 'Revenus par produit' }
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const explainError = (error) => typeof error.detail === 'string' ? error.detail : error.message || 'Could not complete this request.'

export default function AnalyticsWorkspace({ orgs, locale, initialOrg = '', initialDashboardId = '', onOperations, demo = false }) {
  const L = locale === 'fr'
  const [org, setOrg] = useState(() => initialOrg || query().get('org') || '')
  const [createdOrgs, setCreatedOrgs] = useState([])
  const [clientName, setClientName] = useState('')
  const [createError, setCreateError] = useState('')
  const availableOrgs = [...orgs, ...createdOrgs.filter(o => !orgs.some(item => item.id === o.id))]
  async function createClient(e) {
    e.preventDefault(); setCreateError('')
    try { const id = 'workspace-' + crypto.randomUUID().slice(0, 8); const client = await api.createOrg({id, name:clientName.trim(), sub:{fr:'Espace de travail',en:'Workspace'}}); setCreatedOrgs(v => [...v,client]); setOrg(id) } catch (e) {setCreateError(explainError(e))}
  }
  const dirty = useRef(false)
  useEffect(() => {
    if (!org && orgs.length) setOrg(orgs[0].id)
  }, [org, orgs])
  function selectOrg(value) {
    if (dirty.current && !window.confirm(L ? 'Quitter ce tableau sans enregistrer les modifications ?' : 'Leave this dashboard without saving your changes?')) return
    dirty.current = false
    updateUrl('#/studio?workspace=explore&org=' + encodeURIComponent(value))
    setOrg(value)
  }
  return <div className="analytics-workspace">
    <header className="aw-context"><div className="aw-brand"><span className="aw-brand-mark">L</span>Lumnia <span>Studio</span></div><label className="aw-client-label"><span>{L ? 'Espace de travail' : 'Workspace'}</span><select aria-label={L ? 'Client à analyser' : 'Client to analyze'} value={org} onChange={e => selectOrg(e.target.value)}><option value="">{L ? 'Choisir un client' : 'Choose a client'}</option>{availableOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label></header>
    {availableOrgs.some(o => o.id === org)
      ? <Workspace key={org} org={org} locale={locale} initialDashboardId={org === initialOrg ? initialDashboardId : ''} onDirty={value => { dirty.current = value }} onOperations={onOperations} demo={demo} />
      : <div className="aw-welcome"><div className="aw-eyebrow">{L ? 'VOTRE STUDIO' : 'YOUR STUDIO'}</div><h3>{L ? 'Un espace pour vos données.' : 'A workspace for your data.'}</h3><p>{L ? 'Nommez votre espace, puis importez votre premier fichier.' : 'Name your workspace, then upload your first spreadsheet.'}</p><form onSubmit={createClient}><label>{L ? 'Nom du client ou de l’espace' : 'Client or workspace name'}<input value={clientName} maxLength={80} onChange={e => setClientName(e.target.value)} placeholder="My workspace" required /></label><button className="gold-btn" disabled={!clientName.trim()}>{L ? 'Créer un espace' : 'Create workspace'}</button></form>{createError && <p role="alert">{createError}</p>}</div>}
  </div>
}

function Workspace({ org, locale, onDirty, initialDashboardId, onOperations, demo }) {
  const L = locale === 'fr'
  const [state, setState] = useState(emptyState)
  const [panel, setPanel] = useState('studio')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [dataPage, setDataPage] = useState(0)
  const reviewDialog = useRef(null)
  const sampleOpened = useRef(false)
  const [saved, setSaved] = useState([])
  const [dirty, setDirty] = useState(false)
  const [context, setContext] = useState(null)
  const [contextReady, setContextReady] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [question, setQuestion] = useState('')
  const [candidates, setCandidates] = useState([])
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [candidateMapping, setCandidateMapping] = useState(null)
  const fileInput = useRef(null)
  const alive = useRef(true)
  const revision = useRef(0)
  const chatEnd = useRef(null)
  const dirtyRef = useRef(false)

  function markDirty(value) { dirtyRef.current = value; setDirty(value); onDirty(value) }
  function change(patch) { revision.current++; setState(s => ({ ...s, ...patch })); markDirty(true); setNotice('') }
  async function refreshSaved() { const list = await api.listAnalysisDashboards(org); if (alive.current) setSaved(list) }

  useEffect(() => {
    alive.current = true
    let cancelled = false
    Promise.all([api.getOrgContext(org), api.listAnalysisDashboards(org)]).then(([ctx, list]) => {
      if (cancelled) return
      setContext(ctx); setContextReady(true); setSaved(list)
      const id = initialDashboardId || query().get('dashboard')
      if (id && (initialDashboardId || query().get('org') === org)) openSaved(id, true)
    }).catch(e => { if (!cancelled) setError(explainError(e)) })
    return () => { cancelled = true; alive.current = false }
  }, [org])
  useEffect(() => {
    const beforeLeave = e => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', beforeLeave)
    return () => window.removeEventListener('beforeunload', beforeLeave)
  }, [])
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }) }, [state.messages.length])

  function okayToReplace() { return !dirty || window.confirm(L ? 'Remplacer le tableau non enregistré ?' : 'Replace this dashboard without saving your changes?') }
  function newDashboard() {
    if (!okayToReplace()) return
    revision.current++; setState(emptyState()); markDirty(false); setCandidates([]); setNotice(''); setError(''); setPanel('studio'); setUploadOpen(true)
    updateUrl('#/studio?workspace=explore&org=' + encodeURIComponent(org))
  }
  function chooseCandidate(index) {
    setReviewed(false)
    setCandidateIndex(index)
    const d = candidates[index]
    setCandidateMapping({ ...inferMapping(d.headers), metric: defaultMetric(d), dateFormat: L ? 'DMY' : 'MDY' })
  }
  async function upload(file) {
    if (!file || busy || !contextReady) return
    revision.current++; setUploadOpen(true); setReviewed(false)
    setBusy(L ? 'Lecture et préparation du fichier…' : 'Reading and preparing the file…'); setError(''); setNotice('')
    try {
      const { importSpreadsheet } = await import('../lib/analytics/import-spreadsheet')
      const found = await importSpreadsheet(file, { ignoreSheets: context?.ignore_sheets || [] })
      if (!alive.current) return
      setCandidates(found); setCandidateIndex(0)
      setCandidateMapping({ ...inferMapping(found[0].headers), metric: defaultMetric(found[0]), dateFormat: L ? 'DMY' : 'MDY' })
    } catch (e) { if (alive.current) setError(explainError(e)) }
    finally { if (alive.current) setBusy('') }
  }
  function useTable() {
    if (!okayToReplace()) return
    const d = candidates[candidateIndex]
    change({ ...emptyState(), title: (d.name.replace(/\.[^.]+$/, '') + ' · ' + d.sheet).slice(0, 160), dataset: d, mapping: candidateMapping,
      views: d.kind === 'financial' ? ['monthly'] : [],
      messages: [{ role: 'assistant', text: L ? 'Tableau préparé. Posez une question pour créer une vue, puis ajoutez des vues avec vos questions suivantes.' : 'Your table is prepared. Ask a question to create a chart, then add views with follow-up questions.' }] })
    setCandidates([]); setUploadOpen(false); setPanel('studio'); setDataPage(0)
    updateUrl('#/studio?workspace=explore&org=' + encodeURIComponent(org))
  }
  async function openSaved(id, initial = false) {
    if (!initial && !okayToReplace()) return
    revision.current++; setBusy(L ? 'Ouverture du tableau…' : 'Opening dashboard…'); setError('')
    try {
      const d = await api.openAnalysisDashboard(org, id)
      if (!alive.current) return
      setState(d); markDirty(false); setCandidates([]); setUploadOpen(false); setPanel('studio'); setDataPage(0); setNotice(L ? 'Tableau et conversation restaurés.' : 'Dashboard and conversation restored.')
      updateUrl('#/studio?workspace=explore&org=' + encodeURIComponent(org) + '&dashboard=' + encodeURIComponent(id))
    } catch (e) { if (alive.current) setError(explainError(e)) }
    finally { if (alive.current) setBusy('') }
  }
  async function save(asCopy = false) {
    if (!state.dataset || !state.title.trim()) return
    const savedRevision = revision.current
    setBusy(L ? 'Enregistrement…' : 'Saving dashboard…'); setError('')
    try {
      const { title, dataset, mapping, views, messages } = state
      const d = await api.saveAnalysisDashboard(org, { title: title.trim(), dataset, mapping, views, messages, ...(state.id && !asCopy ? { expected_version: state.version } : {}) }, asCopy ? null : state.id)
      if (!alive.current) return
      setState(s => ({ ...s, id: d.id, version: d.version }))
      if (savedRevision === revision.current) markDirty(false)
      setNotice(L ? 'Enregistré. Retrouvez-le dans vos tableaux sauvegardés.' : 'Saved. Reopen it from Saved dashboards.')
      updateUrl('#/studio?workspace=explore&org=' + encodeURIComponent(org) + '&dashboard=' + encodeURIComponent(d.id))
      await refreshSaved()
    } catch (e) { if (alive.current) setError(explainError(e)) }
    finally { if (alive.current) setBusy('') }
  }

  const { dataset, mapping, views } = state
  const finance = useMemo(() => dataset?.kind === 'financial' ? financialAnalysis(dataset, mapping.metric) : null, [dataset, mapping])
  const sales = useMemo(() => dataset && dataset.kind !== 'financial' ? analyze(dataset, mapping) : null, [dataset, mapping])
  const sourceCurrencies = dataset?.kind === 'table' ? currenciesForMeasure(dataset, mapping) : []
  const mixedCurrency = sourceCurrencies.length > 1
  const annualOnly = dataset?.kind === 'table' && /^(year|annee)$/.test(norm(mapping.date))
  const needsMapping = dataset?.kind === 'table' && (!mapping.date || !mapping.revenue || mapping.date === mapping.revenue || !dataset.headers.includes(mapping.date) || !dataset.headers.includes(mapping.revenue))
  const blocked = mixedCurrency || needsMapping
  const charts = useMemo(() => {
    if (!dataset || blocked) return []
    if (finance) return views.map(view => ({
      view, title: view === 'region' ? (L ? 'Répartition par catégorie' : 'Category breakdown') : finance.metric.label,
      rows: (view === 'region' ? finance.breakdown : finance.points).map(p => ({ name: p.name, value: p.value, source: p.source })),
      format: n => metricFormat(n, finance.metric), bars: view === 'region',
    }))
    return views.map(view => ({ view, title: L ? frenchViews[view] : viewLabels[view], rows: sales.groups(view).map(p => ({ name: p.name, value: p.revenue, source: compactSources(p.sources) })), format: n => money(n, mapping.currency), bars: ['region', 'product'].includes(view) }))
  }, [dataset, finance, sales, views, mapping, L, blocked])

  function ask(text) {
    const q = text.trim()
    if (!q || !dataset || busy) return
    let reply, nextViews = views, nextMapping = mapping
    if (blocked) reply = L ? 'Vérifiez les colonnes et les devises avant de créer les graphiques.' : 'Review the column mapping and currencies before creating charts.'
    else if (finance) {
      const out = interpretFinancial(q, dataset, mapping.metric, views)
      reply = out.reply; nextViews = out.views; nextMapping = { ...mapping, metric: out.metric }
    } else if (/insight|summary|resume|synthese|analyse/i.test(norm(q))) {
      const points = sales.groups(annualOnly ? 'yearly' : 'monthly'), top = [...points].sort((a, b) => b.revenue - a.revenue)[0]
      reply = top ? `${L ? 'Période la plus élevée' : 'Highest reported period'}: ${top.name}, ${money(top.revenue, mapping.currency)}. ${L ? 'Source' : 'Source'}: ${compactSources(top.sources)}.` : (L ? 'Aucune ligne exploitable. Vérifiez les colonnes et les dates.' : 'No valid observations. Review the columns and dates.')
      nextViews = [...new Set([...views, annualOnly ? 'yearly' : 'monthly'])]
    } else {
      const out = interpretRequest(q, views, mapping)
      reply = out.reply; nextViews = out.views
      if (annualOnly && out.views.some(v => ['monthly', 'quarterly'].includes(v))) { nextViews = [...new Set(out.views.map(v => ['monthly', 'quarterly'].includes(v) ? 'yearly' : v))]; reply = L ? 'Cette source fournit des valeurs annuelles. Le graphique affiche les revenus par année.' : 'This source reports annual values. The chart shows revenue by year.' }
    }
    change({ views: nextViews, mapping: nextMapping, messages: [...state.messages, { role: 'user', text: q.slice(0, 500) }, { role: 'assistant', text: reply.slice(0, 12000) }].slice(-100) })
    setQuestion(''); setPanel('studio')
  }
  const candidate = candidates[candidateIndex]
  const suggestions = finance ? ['Uncover insights', `Show ${finance.metric.label}`, 'Add a category breakdown'] : L ? ['Afficher les revenus mensuels', 'Ajouter les revenus par région', 'Uncover insights'] : ['Show monthly revenue', 'Add revenue by region', 'Uncover insights']
  const isSample = dataset?.name.startsWith('Lumnia_sample_sales')
  const candidateWarnings = candidate?.report.issues.filter(i => i.severity === 'warning').length || 0
  const candidateAnalysis = useMemo(() => candidate?.kind === 'table' && candidateMapping ? analyze(candidate, candidateMapping) : null, [candidate, candidateMapping])
  const candidateValid = !!candidate && (candidate.kind === 'financial' || (candidateMapping?.date && candidateMapping?.revenue && candidateMapping.date !== candidateMapping.revenue && candidateAnalysis?.count > 0 && currenciesForMeasure(candidate, candidateMapping).length <= 1))
  useEffect(() => {
    const dialog = reviewDialog.current
    if (uploadOpen && dialog && !dialog.open) dialog.showModal()
    else if (!uploadOpen && dialog?.open) dialog.close()
  }, [uploadOpen])
  useEffect(() => {
    if (!demo || !contextReady || sampleOpened.current || initialDashboardId || query().get('dashboard')) return
    let cancelled = false
    import('../lib/analytics/import-spreadsheet').then(({importSpreadsheet}) => importSpreadsheet(sampleSalesFile())).then(found => {
      if (cancelled || revision.current) return
      sampleOpened.current = true
      const d = found[0]
      setState({...emptyState(), title:'Sales overview · Sample', dataset:d, mapping:{...inferMapping(d.headers),dateFormat:'DMY',removeDuplicates:true}, views:['monthly','region'], messages:[{role:'assistant',text:'This is a synthetic sales example. Ask to add revenue by product, or start a new dashboard to upload your spreadsheet. Data, charts and conversation can be saved together.'}]})
    }).catch(e => { if (!cancelled) setError(explainError(e)) })
    return () => {cancelled = true}
  }, [contextReady, demo])
  const recent = saved.slice(0, 5)
  const openUpload = () => {revision.current++; setUploadOpen(true); setReviewed(false)}
  return <>
    <input ref={fileInput} type="file" hidden accept=".xlsx,.xlsm,.csv,.tsv" onChange={e => {upload(e.target.files?.[0]); e.target.value = ''}} />
    <div className="aw-shell">
      <nav className="aw-sidebar" aria-label={L ? 'Navigation du studio' : 'Studio navigation'}>
        <button className="gold-btn aw-new" onClick={newDashboard} disabled={!!busy}><Icon name="plus" />{L ? 'Nouveau tableau' : 'New dashboard'}</button>
        <div className="aw-nav-group"><button className={panel === 'studio' ? 'active' : ''} onClick={() => setPanel('studio')}><Icon name="dashboard" />{L ? 'Studio' : 'Studio'}</button><button className={panel === 'saved' ? 'active' : ''} onClick={() => setPanel('saved')}><Icon name="folder" />{L ? 'Tableaux sauvegardés' : 'Saved dashboards'}<span>{saved.length}</span></button><button className={panel === 'data' ? 'active' : ''} onClick={() => setPanel('data')}><Icon name="database" />{L ? 'Source de données' : 'Data source'}</button></div>
        <div className="aw-nav-caption">{L ? 'RÉCENTS' : 'RECENT'}</div><div className="aw-recents">{recent.length ? recent.map(d => <button key={d.id} disabled={!!busy} onClick={() => openSaved(d.id)} title={d.title}><Icon name="chart" /><span>{d.title}</span></button>) : <p>{L ? 'Vos tableaux enregistrés apparaîtront ici.' : 'Your saved dashboards will appear here.'}</p>}</div>
        <div className="aw-sidebar-bottom"><button onClick={() => upload(sampleSalesFile())} disabled={!!busy || !contextReady}><Icon name="spark" />{L ? 'Essayer un exemple' : 'Try sample data'}</button>{onOperations && <button onClick={onOperations}><Icon name="folder" />{L ? 'Rapports et opérations' : 'Reports & operations'}</button>}<p>XLSX · XLSM · CSV · TSV<br />{L ? 'Données traçables jusqu’à la source.' : 'Trace every figure to its source.'}</p></div>
      </nav>
      <main className="aw-main">
        <div className="aw-dashboard-head"><div><div className="aw-breadcrumb">{L ? 'Espace de travail' : 'Workspace'} <span>/</span> {panel === 'saved' ? (L ? 'Tableaux sauvegardés' : 'Saved dashboards') : panel === 'data' ? (L ? 'Source' : 'Data source') : (L ? 'Tableau de bord' : 'Dashboard')}</div>{dataset ? <input aria-label={L ? 'Nom du tableau de bord' : 'Dashboard name'} className="aw-title-input" maxLength={160} value={state.title} onChange={e => change({title:e.target.value})} /> : <h2>{panel === 'saved' ? (L ? 'Tableaux sauvegardés' : 'Saved dashboards') : (L ? 'Nouveau tableau' : 'New dashboard')}</h2>}</div><button className="gold-btn" disabled={!!busy || !dataset || !state.title.trim() || context?.retain_files === false} onClick={() => save()}><Icon name="save" />{L ? 'Enregistrer' : 'Save dashboard'}</button></div>
        <div className="aw-status" role="status">{busy || notice || (dirty ? (L ? 'Modifications non enregistrées' : 'Unsaved changes') : state.id ? (L ? 'Toutes les modifications sont enregistrées' : 'All changes saved') : '')}</div>{error && <div className="aw-error" role="alert">{error}{state.id && <button className="aw-button" disabled={!!busy} onClick={() => save(true)}>{L ? 'Enregistrer une copie' : 'Save a copy'}</button>}</div>}
        {contextReady && context?.retain_files === false && <div className="aw-warning">{L ? 'La conservation est désactivée. Cette analyse est disponible pendant la session.' : 'Retention is disabled. This analysis is available for this session; saving prepared data is disabled.'}</div>}
        {panel === 'saved' ? <div className="aw-saved-grid">{saved.length ? saved.map(d => <button className="aw-saved-card" key={d.id} disabled={!!busy} onClick={() => openSaved(d.id)}><div className="aw-saved-art"><Icon name="chart" size={34} /><span>{L ? 'Tableau de bord' : 'Dashboard'}</span></div><strong>{d.title}</strong><p>{new Date(d.updated_at).toLocaleDateString(L ? 'fr' : 'en', {month:'short',day:'numeric',year:'numeric'})}</p><span className="aw-saved-open">{L ? 'Ouvrir le tableau' : 'Open dashboard'} →</span></button>) : <div className="aw-chart-empty"><Icon name="folder" size={34}/><h3>{L ? 'Votre travail, prêt à reprendre.' : 'Your work, ready to return to.'}</h3><p>{L ? 'Enregistrez un tableau pour retrouver ses données et sa conversation.' : 'Save a dashboard to reopen its data, charts and conversation here.'}</p><button className="aw-button" onClick={() => setPanel('studio')}>{L ? 'Retour au studio' : 'Back to Studio'}</button></div>}</div>
        : !dataset ? <div className="aw-welcome" onDragOver={e => e.preventDefault()} onDrop={e => {e.preventDefault(); upload(e.dataTransfer.files[0])}}><div className="aw-welcome-icon"><Icon name="spark" size={30}/></div><h3>{L ? 'Que voulez-vous comprendre ?' : 'What would you like to understand?'}</h3><p>{L ? 'Importez votre fichier. Vérifiez sa préparation. Posez votre première question.' : 'Upload your spreadsheet. Review its preparation. Ask your first question.'}</p><div className="aw-welcome-actions"><button className="gold-btn" onClick={openUpload} disabled={!!busy || !contextReady}><Icon name="upload" />{L ? 'Importer un fichier' : 'Upload spreadsheet'}</button><button className="aw-button" onClick={() => upload(sampleSalesFile())} disabled={!!busy || !contextReady}>{L ? 'Essayer un exemple' : 'Try sample data'}</button></div><small>{L ? 'Ou déposez un fichier ici · 8 Mo maximum' : 'Or drop a file here · Up to 8 MB'}</small><div className="aw-starter-prompts">{suggestions.slice(0,2).map(text => <div key={text}><Icon name="chart" /><span>“{text}”</span></div>)}</div></div>
        : <>
          <div className="aw-canvas-tabs"><div role="tablist" aria-label="Dashboard view"><button role="tab" aria-selected={panel === 'studio'} onClick={() => setPanel('studio')}><Icon name="dashboard" />{L ? 'Tableau de bord' : 'Dashboard'}</button><button role="tab" aria-selected={panel === 'data'} onClick={() => setPanel('data')}><Icon name="database" />{L ? 'Données' : 'Data'}</button></div><button className="aw-button" onClick={openUpload} disabled={!!busy}><Icon name="upload" />{L ? 'Remplacer la source' : 'Replace source'}</button></div>
          <div className="aw-source-line"><Icon name="file" /><span>{dataset.name} · {dataset.sheet}</span>{isSample && <b className="aw-sample-badge">{L ? 'Données fictives' : 'Sample data'}</b>}<span>{dataset.rows.length.toLocaleString()} {L ? 'observations' : 'observations'}</span></div>
          {panel === 'data' ? <div className="aw-data-panel"><section className="aw-card"><h3>{L ? 'Préparation et colonnes' : 'Preparation & column mapping'}</h3><MappingControls dataset={dataset} mapping={mapping} onChange={m => change({mapping:m})} L={L}/><Preparation dataset={dataset} L={L}/></section><section className="aw-card"><div className="aw-section-head"><h3>{L ? 'Données préparées' : 'Prepared data'}</h3><span>{dataPage*25+1}–{Math.min(dataset.rows.length,(dataPage+1)*25)} / {dataset.rows.length}</span></div><div className="aw-table-scroll"><table><thead><tr>{dataset.headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{dataset.rows.slice(dataPage*25,(dataPage+1)*25).map((row,i) => <tr key={i}>{row.map((value,j) => <td key={j}>{String(value ?? '—')}</td>)}</tr>)}</tbody></table></div><div className="aw-pagination"><button className="aw-button" disabled={dataPage===0} onClick={() => setDataPage(v=>v-1)}>{L ? 'Précédent' : 'Previous'}</button><button className="aw-button" disabled={(dataPage+1)*25 >= dataset.rows.length} onClick={() => setDataPage(v=>v+1)}>{L ? 'Suivant' : 'Next'}</button></div></section></div>
          : <div className="aw-dashboard">
            {finance && <MappingControls dataset={dataset} mapping={mapping} onChange={m => change({mapping:m})} L={L}/>} {mixedCurrency && <div className="aw-warning">{L ? 'Plusieurs devises détectées' : 'Multiple currencies detected'}: {sourceCurrencies.join(', ')}. {L ? 'Choisissez une source par devise.' : 'Prepare one currency at a time before calculating totals.'}</div>}{needsMapping && <div className="aw-warning">{L ? 'Vérifiez les colonnes dans Données.' : 'Review your date and amount columns in Data.'}</div>}
            {!blocked && <div className="aw-kpis"><Kpi label={finance ? (finance.metric.aggregation === 'last' ? (L ? 'Dernière valeur' : 'Latest value') : finance.metric.label) : (L ? 'Revenus totaux' : 'Total revenue')} value={finance ? metricFormat(finance.total, finance.metric) : money(sales.total, mapping.currency)} source={finance ? compactSources((finance.metric.aggregation === 'last' ? finance.points.slice(-1) : finance.points).flatMap(p=>p.sources)) : compactSources(sales.rows.map(r=>r.source))}/><Kpi label={finance ? (L ? 'Périodes' : 'Periods') : (L ? 'Lignes analysées' : 'Rows analyzed')} value={(finance ? finance.points.length : sales.count).toLocaleString()}/><Kpi label={L ? 'Qualité des données' : 'Data quality'} value={`${dataset.report.issues.filter(i=>i.severity==='warning').length} ${L ? 'à vérifier' : 'to review'}`}/></div>}
            {sales?.excluded > 0 && <div className="aw-warning">{sales.excluded} {L ? 'lignes exclues' : 'rows excluded'} · {sales.invalidDate} {L ? 'dates invalides' : 'invalid dates'} · {sales.invalidRevenue} {L ? 'montants invalides' : 'invalid amounts'} · {sales.duplicatesRemoved} {L ? 'doublons exclus' : 'duplicates excluded'}. {L ? 'Les motifs peuvent se recouper.' : 'Reasons may overlap.'}</div>}
            <div className="aw-chart-grid">{charts.map(chart => <ChartCard key={chart.view} chart={chart} L={L} remove={() => change({views:views.filter(v=>v!==chart.view)})}/>)}</div>
            {!charts.length && <section className="aw-card aw-chart-empty"><Icon name="chart" size={32}/><h3>{L ? 'Votre source est prête.' : 'Your data is ready.'}</h3><p>{L ? 'Posez une question pour créer votre premier graphique.' : 'Ask a question to create your first chart.'}</p><button className="aw-button" onClick={() => ask(suggestions[0])}>{suggestions[0]} →</button></section>}
            {finance && !blocked && <section className="aw-card aw-insights"><div className="aw-section-head"><h3><Icon name="spark" />{L ? 'Constats calculés' : 'Calculated insights'}</h3><span>{dataset.financial.basis === 'projection' ? (L ? 'Projections / plan' : 'Projections / plan') : (L ? 'Données du classeur' : 'Workbook values')}</span></div>{finance.insights.map((insight,i)=><article key={i}><strong>{insight.title}</strong><p>{insight.text}</p><SourceDetail source={insight.source}/></article>)}</section>}
          </div>}
        </>}
      </main>
      <aside className="aw-conversation" aria-label={L ? 'Assistant Lumnia' : 'Lumnia assistant'}><div className="aw-chat-header"><div className="aw-assistant-mark"><Icon name="spark"/></div><div><h3>{L ? 'Assistant Lumnia' : 'Lumnia assistant'}</h3><span>{L ? 'Explorez vos données' : 'Explore your data'}</span></div></div><div className="aw-messages" role="log" aria-live="polite">{state.messages.length ? state.messages.map((message,i)=><div key={i} className={'aw-message '+message.role}><span>{message.role === 'user' ? (L ? 'Vous' : 'You') : 'Lumnia'}</span><p>{message.text}</p></div>) : <div className="aw-message assistant"><span>Lumnia</span><p>{L ? 'Importez un fichier pour commencer. Je vous aiderai à vérifier la préparation, explorer les chiffres et construire votre tableau.' : 'Upload a spreadsheet to begin. I’ll help you review the preparation, explore the figures and build your dashboard.'}</p></div>}<div ref={chatEnd}/></div><div className="aw-suggestions">{suggestions.map(text=><button key={text} disabled={!!busy || !dataset} onClick={()=>ask(text)}>{text}<span>↗</span></button>)}</div><form className="aw-composer" onSubmit={e=>{e.preventDefault();ask(question)}}><label className="aw-sr-only" htmlFor="aw-question">{L ? 'Votre question' : 'Ask about your data'}</label><textarea id="aw-question" maxLength={500} rows={3} value={question} disabled={!!busy || !dataset} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask(question)}}} placeholder={L ? 'Posez une question sur vos données…' : 'Ask about your data…'}/><div><small>{L ? 'Entrée pour envoyer' : 'Enter to send'}</small><button className="gold-btn" aria-label={L ? 'Envoyer' : 'Send question'} disabled={!question.trim() || !!busy || !dataset}><Icon name="arrow"/></button></div></form><p className="aw-chat-foot">{L ? 'Les réponses utilisent les données de ce tableau.' : 'Answers use this dashboard’s prepared data.'}</p></aside>
    </div>
    <dialog className="aw-review-dialog" ref={reviewDialog} onCancel={e=>{if(busy)e.preventDefault();else setUploadOpen(false)}} onClose={()=>setUploadOpen(false)}><div className="aw-dialog-head"><div><div className="aw-eyebrow">{L ? 'PRÉPARATION DES DONNÉES' : 'DATA PREPARATION'}</div><h2>{candidate ? (L ? 'Vérifiez avant d’explorer.' : 'Review before you explore.') : (L ? 'Ajoutez votre fichier.' : 'Bring your spreadsheet.')}</h2></div><button className="aw-button" disabled={!!busy} aria-label="Close preparation" onClick={()=>setUploadOpen(false)}>×</button></div><p>{L ? 'Vos cellules sources sont conservées. Les points ambigus restent visibles pour votre vérification.' : 'Source cells stay traceable. Ambiguous values stay visible for your review.'}</p>{busy && <div className="aw-status" role="status">{busy}</div>}{error && <div className="aw-error" role="alert">{error}</div>}{!candidate ? <div className="aw-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();upload(e.dataTransfer.files[0])}}><Icon name="upload" size={32}/><h3>{L ? 'Déposez un fichier ici' : 'Drop your spreadsheet here'}</h3><p>XLSX · XLSM · CSV · TSV · 8 MB</p><button className="gold-btn" onClick={()=>fileInput.current?.click()} disabled={!!busy}>{L ? 'Choisir un fichier' : 'Choose file'}</button></div> : <><label>{L ? 'Tableau détecté' : 'Detected table'}<select value={candidateIndex} onChange={e=>chooseCandidate(Number(e.target.value))}>{candidates.map((d,i)=><option key={i} value={i}>{d.sheet} · {d.rows.length.toLocaleString()} observations</option>)}</select></label><div className="aw-prep-summary"><span><b>{candidate.rows.length.toLocaleString()}</b>{L ? 'observations' : 'observations'}</span><span><b>{candidate.report.changes.length}</b>{L ? 'transformations' : 'preparation steps'}</span><span><b>{candidateWarnings}</b>{L ? 'points à vérifier' : 'review notes'}</span></div><MappingControls dataset={candidate} mapping={candidateMapping} onChange={setCandidateMapping} L={L}/><Preparation dataset={candidate} L={L}/>{candidateWarnings > 0 && <label className="aw-check aw-ack"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>{L ? 'J’ai consulté les points signalés et vérifié les colonnes.' : 'I reviewed the flagged items and checked the column mapping.'}</label>}<div className="aw-dialog-actions"><button className="aw-button" disabled={!!busy} onClick={()=>fileInput.current?.click()}>{L ? 'Choisir un autre fichier' : 'Choose another file'}</button><button className="gold-btn" disabled={!!busy || !candidateValid || (candidateWarnings > 0 && !reviewed)} onClick={useTable}>{candidate.kind === 'financial' ? (L ? 'Approuver et découvrir les constats' : 'Approve & uncover insights') : (L ? 'Approuver et utiliser ces données' : 'Approve & use data')}<Icon name="arrow"/></button></div>{!candidateValid && <p className="aw-warning">{L ? 'Vérifiez les colonnes date et montant et séparez les devises.' : 'Choose distinct date and amount columns with usable values, and keep currencies separate.'}</p>}</>}</dialog>
  </>
}

function MappingControls({ dataset, mapping, onChange, L }) {
  if (!mapping) return null
  if (dataset.kind === 'financial') return <label className="aw-measure">{L ? 'Mesure à explorer' : 'Measure to explore'}<select value={mapping.metric} onChange={e => onChange({ ...mapping, metric: e.target.value })}>{dataset.financial.metrics.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
  return <div className="aw-mapping">
    {[['date', L ? 'Date' : 'Date'], ['revenue', L ? 'Montant / revenus' : 'Amount / revenue'], ['region', L ? 'Région' : 'Region'], ['product', L ? 'Produit / catégorie' : 'Product / category']].map(([key, label]) => <label key={key}>{label}<select value={mapping[key]} onChange={e => onChange({ ...mapping, [key]: e.target.value })}><option value="">{L ? 'Non défini' : 'Not mapped'}</option>{dataset.headers.map(h => <option key={h} value={h}>{h}</option>)}</select></label>)}
    <label>{L ? 'Ordre des dates' : 'Date order'}<select value={mapping.dateFormat} onChange={e => onChange({ ...mapping, dateFormat: e.target.value })}><option value="MDY">MM/DD/YYYY</option><option value="DMY">DD/MM/YYYY</option></select></label>
    <label>{L ? 'Devise déclarée' : 'Reported currency'}<select value={mapping.currency} onChange={e => onChange({ ...mapping, currency: e.target.value })}>{['UNSPECIFIED', 'USD', 'CDF', 'EUR', 'GBP', 'CAD', 'AUD', 'XOF', 'XAF'].map(c => <option key={c} value={c}>{c === 'UNSPECIFIED' ? (L ? 'Non précisée' : 'Not specified') : c}</option>)}</select></label>
    {dataset.report.duplicateRows > 0 && <label className="aw-check"><input type="checkbox" checked={!!mapping.removeDuplicates} onChange={e => onChange({ ...mapping, removeDuplicates: e.target.checked })} />{L ? 'Exclure les doublons exacts des calculs' : 'Exclude exact duplicates from calculations'}</label>}
    <small className="aw-mapping-note">{L ? 'La devise indique l’unité des données ; aucune conversion n’est effectuée. Vérifiez les dates ambiguës avant de poursuivre.' : 'Currency labels the source values; no conversion is applied. Review ambiguous dates before continuing.'}</small>
  </div>
}

function Preparation({ dataset, L }) {
  const r = dataset.report
  return <div className="aw-review">
    <div className="aw-review-meta">{r.sheet}!{r.range} · {r.layout} · {dataset.rows.length.toLocaleString()} {L ? 'observations préparées' : 'prepared observations'}</div>
    <div className="aw-review-grid"><div><h5>{L ? 'Transformations' : 'Preparation changes'}</h5><ul>{r.changes.map((change, i) => <li key={i}>{change}</li>)}</ul></div><div><h5>{L ? 'Points à vérifier' : 'Review notes'}</h5><ul>{r.issues.map((issue, i) => <li className={issue.severity} key={i}>{issue.message}{issue.source && <code>{issue.source}</code>}</li>)}</ul></div></div>
    <div className="aw-review-grid"><div><h5>{L ? 'Aperçu source' : 'Source preview'}</h5><div className="aw-table-scroll"><table><tbody>{r.preview.map(row => <tr key={row.row}><th scope="row">{row.row}</th>{row.cells.map((value, i) => <td key={i}>{String(value ?? '—')}</td>)}</tr>)}</tbody></table></div></div><div><h5>{L ? 'Données préparées · aperçu' : 'Prepared data · preview'}</h5><div className="aw-table-scroll"><table><thead><tr>{dataset.headers.slice(0, 12).map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{dataset.rows.slice(0, 8).map((row, i) => <tr key={i}>{row.slice(0, 12).map((v, j) => <td key={j}>{String(v ?? '—')}</td>)}</tr>)}</tbody></table></div></div></div>
  </div>
}

function SourceDetail({ source }) { return source ? <details className="aw-source"><summary>Source</summary><code>{source}</code></details> : null }
function Kpi({ label, value, source }) { return <div className="aw-card aw-kpi"><span>{label}</span><strong>{value}</strong><SourceDetail source={source} /></div> }
function ChartCard({ chart, L, remove }) {
  const C = chart.bars ? BarChart : AreaChart
  return <section className="aw-card aw-chart"><div className="aw-section-head"><h4>{chart.title}</h4><button className="aw-button" aria-label={(L ? 'Retirer ' : 'Remove ') + chart.title} onClick={remove}>×</button></div>
    {chart.rows.length ? <><div className="aw-plot"><ResponsiveContainer width="100%" height="100%"><C data={chart.rows} margin={{ top: 12, right: 18, left: 12, bottom: 12 }}><CartesianGrid stroke="#e8ece9" vertical={false} /><XAxis dataKey="name" tick={{ fill: '#64746b', fontSize: 12 }} minTickGap={28} /><YAxis tick={{ fill: '#64746b', fontSize: 12 }} width={76} tickFormatter={n => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)} /><Tooltip formatter={n => chart.format(Number(n))} contentStyle={{ background: '#ffffff', border: '1px solid #dce5df', color: '#20382b' }} />{chart.bars ? <Bar dataKey="value" name={chart.title} fill="#287f5d" radius={[3, 3, 0, 0]} /> : <Area type="linear" dataKey="value" name={chart.title} stroke="#287f5d" fill="#287f5d" fillOpacity={.12} strokeWidth={2} />}</C></ResponsiveContainer></div>
      <details><summary>{L ? 'Valeurs et cellules sources' : 'Values & source cells'}</summary><div className="aw-table-scroll"><table><thead><tr><th>{L ? 'Période / catégorie' : 'Period / category'}</th><th>{L ? 'Valeur' : 'Value'}</th><th>Source</th></tr></thead><tbody>{chart.rows.map((p, i) => <tr key={i}><th scope="row">{p.name}</th><td>{chart.format(p.value)}</td><td><code>{p.source}</code></td></tr>)}</tbody></table></div></details></> : <p>{L ? 'Aucune observation exploitable pour cette vue.' : 'No usable observations for this view.'}</p>}
  </section>
}

function Icon({name, size=18}) {
 const paths={plus:'M12 5v14M5 12h14',dashboard:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',folder:'M3 7V5h6l2 2h10v13H3z',database:'M4 6c0-4 16-4 16 0s-16 4-16 0Zm0 0v12c0 4 16 4 16 0V6M4 12c0 4 16 4 16 0',chart:'M4 3v17h17M8 16v-5m5 5V7m5 9V4',file:'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',save:'M4 3h13l4 4v14H3V3zM7 3v6h9V3M7 21v-8h10v8',upload:'M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7',spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',arrow:'M12 19V5m-6 6 6-6 6 6'}
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.chart}/></svg>
}
