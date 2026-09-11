import { useState } from 'react'
import { ArrowRight, FileSpreadsheet, LoaderCircle, ShieldCheck } from 'lucide-react'
import { LumniaLogo } from '../components/branding/LumniaBrand'
import './workspace-entry.css'

export default function WorkspaceSignIn({ onSignIn, expired = false }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    if (busy || !username.trim() || !password) return
    setBusy(true)
    setError('')
    try {
      await onSignIn(username.trim(), password)
    } catch (error) {
      setError(error.status === 429
        ? 'Too many attempts. Please try again in a few minutes.'
        : error.status === 401 || error.status === 403
          ? 'Check your username and password, then try again.'
          : 'We couldn’t connect to your workspace. Please try again.')
      if (error.status === 401 || error.status === 403) setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return <main className="ws-entry">
    <section className="ws-entry-intro">
      <a href="/" aria-label="Lumnia home"><LumniaLogo /></a>
      <div className="ws-entry-story">
        <span className="ws-eyebrow">Lumnia Studio</span>
        <h1>Your data.<br />A clearer way forward.</h1>
        <p>Prepare your files, explore the findings and shape the dashboard through conversation.</p>
        <ol><li><FileSpreadsheet size={20} /><span>Upload your workbooks together</span></li><li><ArrowRight size={20} /><span>Open a review built from your data</span></li><li><ShieldCheck size={20} /><span>Save your work and pick up where you left off</span></li></ol>
      </div>
      <p className="ws-entry-tagline">Light where there was none.</p>
    </section>
    <section className="ws-entry-form-panel">
      <form className="ws-entry-form" onSubmit={submit}>
        <span className="ws-eyebrow">Client workspace</span>
        <h2>Welcome back.</h2>
        <p>Sign in to open your analyses and published reports.</p>
        {expired && <p className="ws-entry-message" role="status">Your session ended. Sign in again to reopen your saved work.</p>}
        <label htmlFor="workspace-username">Username</label>
        <input id="workspace-username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username} onChange={event => setUsername(event.target.value)} disabled={busy} />
        <label htmlFor="workspace-password">Password</label>
        <input id="workspace-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
        {error && <p className="ws-entry-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy || !username.trim() || !password}>{busy ? <LoaderCircle size={18} className="ws-spin" /> : <ArrowRight size={18} />}{busy ? 'Opening your workspace…' : 'Open workspace'}</button>
        <p className="ws-entry-help">Use the client login provided by Lumnia. <a href="/signup/">Request access</a></p>
      </form>
    </section>
  </main>
}

export function WorkspaceState({ error, onRetry, message = 'Opening your workspace…' }) {
  return <main className="ws-state"><LumniaLogo variant="paper" /><div role={error ? 'alert' : 'status'}>{!error && <LoaderCircle size={24} className="ws-spin" />}<h1>{error ? 'Your workspace couldn’t be opened' : message}</h1>{error && <><p>{error}</p><button type="button" onClick={onRetry}>Try again</button></>}</div></main>
}
