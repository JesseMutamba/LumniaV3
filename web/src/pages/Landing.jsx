import { useState } from 'react'
import mark from '../assets/lumnia-mark.png'

/**
 * The public face. Everything above the sign-in panel is for someone who has
 * never heard of us; the panel itself is for the client who comes back every
 * month. Both live on one page because a client should not have to remember
 * a second address, and a prospect should not have to be told what we do by
 * a login box.
 *
 * Styling lives in styles.css under .ld-*, not inline: the design arrived as
 * inline attributes, which cannot express a media query, and this page has
 * to survive a phone.
 */

const STEPS = [
  {
    n: '01',
    title: 'Upload',
    body: 'Drop in your files exactly as you keep them. No templates, no schema, no IT project.',
  },
  {
    n: '02',
    title: 'Structure',
    body: 'We ingest, clean, and structure the data — reconciling formats and surfacing errors as it goes.',
  },
  {
    n: '03',
    title: 'Intelligence',
    body: 'Dashboards, forecasts, and recommendations — every figure traceable to the row it came from.',
    lit: true,
  },
]

const PILLARS = [
  { title: 'Light', body: 'Making hidden business realities visible.', dot: 'a' },
  { title: 'Clarity', body: 'Turning complexity into understanding.', dot: 'b' },
  { title: 'Intelligence', body: 'Seeing what matters — and acting with confidence.', dot: 'c' },
]

const CAPABILITIES = [
  ['Interface', 'Live flow map across the logistics route'],
  ['Performance', 'KPI rows tracking cost and movement'],
  ['Context', 'Briefs that explain what is changing'],
  ['Trust', 'Every figure back to its source'],
  ['Analysis', 'Period switching for trend comparison'],
]

export default function Landing({ onSignIn }) {
  return (
    <div className="ld">
      <nav className="ld-nav">
        <div className="ld-wrap ld-nav-in">
          <a className="ld-brand" href="#/">
            <img src={mark} alt="" />
            <span>LUMNIA</span>
          </a>
          <div className="ld-nav-links">
            <a href="#problem">The problem</a>
            <a href="#how">How it works</a>
            {/* was "What we built" in the nav and "What we've built" in the
                section it points at — one of them had to go */}
            <a href="#proof">What we&rsquo;ve built</a>
            <a className="ld-ghost" href="#signin">Client sign-in</a>
            <a className="ld-cta" href="#contact">Request a pilot</a>
          </div>
        </div>
      </nav>

      <header className="ld-hero">
        <div className="ld-wrap ld-hero-in">
          <img className="ld-lum" src={mark} alt="Lumnia" />
          <h1>Light where there was none.</h1>
          <p className="ld-lede">
            The operating-intelligence layer for African industry. Upload raw operational
            files — exactly as you keep them — and Lumnia turns scattered, delayed data into
            clear intelligence your leaders can act on.
          </p>
          <div className="ld-actions">
            <a className="ld-cta" href="#contact">Request a pilot</a>
            <a className="ld-btn" href="#how">See how it works</a>
          </div>
          {/* "ESTD" is not a standard abbreviation of established; "EST." is */}
          <div className="ey ld-estd">
            EST. 2026 &nbsp;·&nbsp; DEMOCRATIC REPUBLIC OF CONGO &nbsp;·&nbsp; CENTRAL AFRICA
          </div>
        </div>
      </header>

      {/* The numbered sections ran II, III, X, VII with no I. They are the
          reader's handrail through the page, so they now count. */}
      <section id="problem" className="ld-pale">
        <div className="ld-wrap ld-split">
          <div>
            <div className="ey ld-ey-dim">I · The problem</div>
            <h2 className="ld-h2">Billion-dollar operations run on memory, not on data.</h2>
          </div>
          <div className="ld-rule-l">
            <p>
              Across Central Africa, operators run enormous, complex businesses on
              spreadsheets, manual records, and reports that arrive weeks late.
            </p>
            <p>
              The data exists — but it&rsquo;s fragmented across formats, full of errors, and
              never structured. Western BI tools assume clean data and an in-house technical
              team. Most companies have neither. So the cost stays invisible until it&rsquo;s
              already lost.
            </p>
          </div>
        </div>
      </section>

      <section id="how" className="ld-dark">
        <div className="ld-wrap">
          <div className="ld-mid">
            <div className="ey ld-ey-gold">II · What we&rsquo;re building</div>
            <h2 className="ld-h2 ld-h2-l">
              Upload raw data. Get intelligence.
              <br />
              No configuration.
            </h2>
            <p className="ld-sub">
              A zero-touch platform. Native Excel, no cleanup, no setup — Lumnia ingests,
              cleans, structures, and interprets automatically, from raw rows through to
              forecasts and recommendations.
            </p>
          </div>
          <div className="ld-cards">
            {STEPS.map((s) => (
              <div key={s.n} className={`ld-card${s.lit ? ' lit' : ''}`}>
                <div className="ey">{s.n}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ld-dark ld-rule-t">
        <div className="ld-wrap ld-rule-band">
          <div className="ey ld-ey-dim">The one rule</div>
          <p className="ld-maxim">
            Unknowns are never shown as known. Every number traces back to its source.
          </p>
        </div>
      </section>

      <section className="ld-stone">
        <div className="ld-wrap ld-pillars">
          {PILLARS.map((p) => (
            <div key={p.title} className="ld-pillar">
              <div className="ld-mark">
                <div className={`ld-dot ${p.dot}`} />
              </div>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="proof" className="ld-dark">
        <div className="ld-wrap">
          <div className="ld-proof-head">
            <div>
              <div className="ey ld-ey-gold">III · What we&rsquo;ve built</div>
              <h2 className="ld-h2 ld-h2-l">The Corridor Flow Map</h2>
              <p className="ld-sub ld-sub-l">
                A working logistics-intelligence system — built, deployed, and running on
                real corridor data.
              </p>
            </div>
            <div className="ld-stats">
              <div>
                <div className="ld-stat">5</div>
                <div className="ey ld-ey-dim">Capabilities</div>
              </div>
              <div>
                <div className="ld-stat">100%</div>
                <div className="ey ld-ey-dim">Traceable</div>
              </div>
            </div>
          </div>
          <div className="ld-shot">
            <div className="ey">Product shot · live dashboard</div>
            <div className="ld-shot-sub">
              corridor flow map · KPI rows · intelligence-brief cards
            </div>
          </div>
          <div className="ld-caps">
            {CAPABILITIES.map(([k, v]) => (
              <div key={k}>
                <div className="ey ld-ey-gold">{k}</div>
                <p>{v}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ld-pale">
        <div className="ld-wrap ld-market">
          <div>
            <div className="ey ld-ey-dim">IV · Market</div>
            <div className="ld-big">$447B</div>
            <p>
              The African logistics and industrial-operations market by 2029. No DRC-native
              intelligence platform exists today.
            </p>
          </div>
          <div className="ld-rule-l">
            <div className="ld-med">$12B</div>
            <p>Serviceable market — DRC and Francophone Africa</p>
          </div>
          <div className="ld-rule-l">
            <div className="ld-med">$180M</div>
            {/* "SOM" unexplained on a page a prospect reads */}
            <p>Bottom-up serviceable obtainable market — 159 clients, 7 verticals, by Year 5</p>
          </div>
        </div>
      </section>

      <SignIn onSignIn={onSignIn} />

      <footer id="contact" className="ld-foot">
        <div className="ld-wrap">
          <div className="ld-foot-in">
            <img className="ld-lum ld-lum-sm" src={mark} alt="" />
            <h2 className="ld-h2 ld-h2-l">See the state of your business clearly.</h2>
            <p className="ld-sub">
              90 days to the first pilot. Precision over volume — always.
            </p>
            <a className="ld-cta ld-cta-lg" href="mailto:hello@lumnia.africa">
              Request a pilot
            </a>
          </div>
          <div className="ld-foot-bar">
            <a className="ld-brand" href="#/">
              <img src={mark} alt="" />
              <span>LUMNIA</span>
            </a>
            <div className="ey ld-ey-dim">
              Light where there was none &nbsp;·&nbsp; EST. 2026
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

/* ---------------------------------------------------------------- sign-in */

function SignIn({ onSignIn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!username.trim() || !password) return
    setBusy(true)
    setErr(null)
    try {
      await onSignIn(username.trim(), password)
    } catch (e) {
      // The API refuses to say which half was wrong, and neither will we.
      setErr(
        e.status === 429
          ? 'Too many attempts. Try again in a few minutes.'
          : 'Wrong username or password.'
      )
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="signin" className="ld-dark ld-rule-t">
      <div className="ld-wrap ld-signin">
        <div>
          <div className="ey ld-ey-gold">Clients</div>
          <h2 className="ld-h2 ld-h2-l">Your reports, whenever you need them.</h2>
          <p className="ld-sub ld-sub-l">
            Sign in to open every report published for you. No link to find, no key to keep.
            If you don&rsquo;t have a login yet, ask us for one.
          </p>
        </div>
        <form className="ld-form" onSubmit={submit}>
          <label>
            <span className="ey ld-ey-dim">Username</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="pvak-finance"
            />
          </label>
          <label>
            <span className="ey ld-ey-dim">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {err && <div className="ld-err">{err}</div>}
          <button className="ld-cta ld-cta-lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </section>
  )
}
