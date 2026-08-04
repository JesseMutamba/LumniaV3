import Prov from './Prov.jsx'
import { fmt, signed, t, nf, MONTHS } from '../lib/format.js'

/* ------------------------------------------------------------------ text */

const Heading = ({ b, locale }) => (
  <div className="b">
    {b.label && <div className="b-label">{t(b.label, locale)}</div>}
    {b.level === 3 ? (
      <h3 className="b-t">{t(b.text, locale)}</h3>
    ) : (
      <h2 className="b-t">{t(b.text, locale)}</h2>
    )}
    {b.dek && <p className="b-dek">{t(b.dek, locale)}</p>}
  </div>
)

const Prose = ({ b, locale }) => (
  <div className="b">
    <p className="b-prose">{t(b.text, locale)}</p>
  </div>
)

/* ------------------------------------------------------------------ kpis */

const KpiGrid = ({ b, locale, sources }) => (
  <div className="b">
    <div className="kpis">
      {b.items.map((it, i) => (
        <div className="kpi" key={i}>
          <div className="k">{t(it.label, locale)}</div>
          <div className={`v ${it.tone}`}>
            {it.value.derived === 'delta' ? signed(it.value, locale) : fmt(it.value, locale)}
          </div>
          <div className="s">
            {t(it.sub, locale)}
            <Prov src={it.value.src} sources={sources} />
          </div>
        </div>
      ))}
    </div>
  </div>
)

/* ------------------------------------------------------------------ rail */

const Rail = ({ b, locale, sources }) => (
  <div className="b">
    <div className="rail">
      <div className="rail-h">
        <span>{locale === 'fr' ? 'Exécution' : 'Execution'}</span>
        <div className="key">
          <i>
            <span className="sw env" />
            {locale === 'fr' ? 'Enveloppe' : 'Envelope'}
          </i>
          <i>
            <span className="sw act" />
            {locale === 'fr' ? 'Réel' : 'Actual'}
          </i>
          <i>
            <span className="sw pace" />
            {locale === 'fr' ? 'Rythme prévu' : 'Planned pace'}
          </i>
        </div>
      </div>
      {b.rows.map((r, i) => {
        const wA = (r.actual.n / r.envelope.n) * 100
        const wP = (r.pace.n / r.envelope.n) * 100
        return (
          <div className="rr" key={i}>
            <div className="rr-t">
              <div className="rr-n">
                {t(r.label, locale)}
                <Prov src={r.actual.src} sources={sources} />
              </div>
              <div className="rr-v">
                <b>{fmt(r.actual, locale)}</b> {locale === 'fr' ? 'contre' : 'vs'}{' '}
                {fmt(r.pace, locale)} {locale === 'fr' ? 'sur' : 'of'}{' '}
                {fmt(r.envelope, locale)}
              </div>
            </div>
            <div className="bar">
              <div className="fill" style={{ width: `${wA}%` }} />
              <div
                className="env"
                style={{ left: `${wA}%`, width: `${Math.max(0, wP - wA)}%` }}
              />
              <div className="notch" style={{ left: `${wP}%` }} />
              <div className="pct">{nf((r.actual.n / r.pace.n) * 100, locale, 1)} %</div>
            </div>
          </div>
        )
      })}
    </div>
  </div>
)

/* --------------------------------------------------------------- barPair */

function BarPair({ b, locale, sources }) {
  const x = b.x === 'months' ? MONTHS[locale] : b.x
  const [plan, act] = b.series
  const vals = (s) => (s ? s.values.map((v) => v.n) : [])
  const W = 960,
    H = 248,
    P = { t: 16, r: 10, b: 26, l: 56 }
  const max = Math.max(...vals(plan), ...vals(act)) * 1.12
  const iw = W - P.l - P.r,
    ih = H - P.t - P.b
  const bw = iw / x.length,
    gap = bw * 0.22,
    w = (bw - gap) / 2
  const y = (v) => P.t + ih - (v / max) * ih
  const lab = (v) => (b.fmt === 'k' ? `${nf(v / 1000, locale)}k` : nf(v, locale))

  return (
    <div className="b">
      <div className="card">
        <div className="card-h">
          <span>
            {t(b.title, locale)}
            <Prov src={plan?.values?.[0]?.src} sources={sources} />
          </span>
          <span className="key">
            <i>
              <span className="sw plan" />
              {t(plan?.label, locale) || 'Budget'}
            </i>
            {act && (
              <i>
                <span className="sw actg" />
                {t(act.label, locale) || (locale === 'fr' ? 'Réel' : 'Actual')}
              </i>
            )}
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t(b.title, locale)}>
          {[1, 2, 3, 4].map((i) => {
            const v = (max * i) / 4
            return (
              <g key={i}>
                <line className="gl" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} />
                <text className="ax" x={P.l - 8} y={y(v) + 3.5} textAnchor="end">
                  {lab(v)}
                </text>
              </g>
            )
          })}
          <line className="base" x1={P.l} x2={W - P.r} y1={P.t + ih} y2={P.t + ih} />
          <text className="ax" x={P.l - 8} y={P.t + ih + 3.5} textAnchor="end">
            {lab(0)}
          </text>
          {x.map((m, i) => {
            const x0 = P.l + i * bw + gap / 2
            const p = plan?.values[i]?.n
            const a = act?.values[i]?.n
            return (
              <g key={m + i}>
                {p !== undefined && (
                  <rect x={x0} y={y(p)} width={w} height={Math.max(0, P.t + ih - y(p))} className="bar-plan">
                    <title>{`${m} · ${t(plan?.label, locale) || 'Budget'} : ${nf(p, locale)}`}</title>
                  </rect>
                )}
                {a !== undefined && (
                  <rect x={x0 + w} y={y(a)} width={w} height={Math.max(0, P.t + ih - y(a))} className="bar-act">
                    <title>{`${m} · ${t(act?.label, locale) || (locale === 'fr' ? 'Réel' : 'Actual')} : ${nf(a, locale)}`}</title>
                  </rect>
                )}
                <text className="ax" x={P.l + i * bw + bw / 2} y={H - 8} textAnchor="middle">
                  {m}
                </text>
              </g>
            )
          })}
          {b.cutoff != null && (
            <g>
              <line
                className="cut"
                x1={P.l + b.cutoff * bw}
                x2={P.l + b.cutoff * bw}
                y1={P.t - 6}
                y2={P.t + ih}
              />
              <text className="cut-t" x={P.l + b.cutoff * bw + 7} y={P.t - 2}>
                {locale === 'fr' ? 'fin des réels' : 'end of actuals'}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ flag */

function Tree({ payload, locale }) {
  if (!payload?.parents) return null
  const pad = (s, n) => String(s).padEnd(n).slice(0, n)
  const num = (v) => nf(v, locale, 2).padStart(12)
  const lines = []
  payload.parents.forEach((p) => {
    lines.push(
      <span key={p.parent}>
        {pad(p.parent, 28)}
        {num(p.value)}
        {'  '}
        <span className="a">
          {locale === 'fr' ? 'parent ✓ Σ enfants' : 'parent ✓ Σ children'} = {nf(p.value, locale, 2)} ·{' '}
          {locale === 'fr' ? 'écart' : 'delta'} {nf(p.delta, locale, 2)}
        </span>
        {'\n'}
      </span>
    )
    p.children.forEach((c, i) => {
      lines.push(
        <span className="c" key={p.parent + c.name}>
          {`  ${i === p.children.length - 1 ? '└─' : '├─'} `}
          {pad(c.name, 24)}
          {num(c.value)}
          {'\n'}
        </span>
      )
    })
    lines.push(<span key={p.parent + '-gap'}>{'\n'}</span>)
  })
  const L = (k, v, cls) => (
    <span className={cls} key={k}>
      {pad(k, 28)}
      {num(v)}
      {'\n'}
    </span>
  )
  lines.push(L(locale === 'fr' ? 'SOMME NAÏVE COLONNE' : 'NAIVE COLUMN SUM', payload.naive_sum, 'r'))
  lines.push(L(locale === 'fr' ? 'PARENTS SEULS (retenu)' : 'PARENTS ONLY (used)', payload.correct_sum, 'a'))
  lines.push(L(locale === 'fr' ? 'SURÉVALUATION ÉVITÉE' : 'OVERSTATEMENT AVOIDED', payload.overstatement, 'r'))
  return <div className="tree">{lines}</div>
}

const Flag = ({ b, locale, sources }) => (
  <div className="b">
    <div className="flag" data-sev={b.severity}>
      <div className="flag-tag">{t(b.tag, locale)}</div>
      <h3 className="b-t">
        {t(b.title, locale)}
        <Prov src={b.src} sources={sources} />
      </h3>
      <p>{t(b.body, locale)}</p>
      {b.evidence?.kind === 'tree' && <Tree payload={b.evidence.payload} locale={locale} />}
    </div>
  </div>
)

/* ----------------------------------------------------------------- table */

const cellOf = (v, locale) =>
  v && typeof v === 'object' ? fmt(v, locale) : String(v ?? '')

const Table = ({ b, locale, sources }) => (
  <div className="b">
    <div className="scroll">
      <table>
        <thead>
          <tr>
            {b.columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align }}>
                {t(c.label, locale)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.rows.map((row, i) => (
            <tr key={i}>
              {b.columns.map((c) => {
                const v = row[c.key]
                const neg = v && typeof v === 'object' && v.n < 0
                return (
                  <td key={c.key} className={c.signed ? (neg ? 'neg' : 'pos') : ''}>
                    {c.signed && typeof v === 'object' ? signed(v, locale) : cellOf(v, locale)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="src-note">
      {locale === 'fr' ? 'Source' : 'Source'}
      <Prov src={b.rows?.[0]?.[b.columns[1]?.key]?.src} sources={sources} />
    </div>
  </div>
)

/* ---------------------------------------------------------------- ledger */

const Ledger = ({ locale, sources }) => {
  const th =
    locale === 'fr'
      ? ['Fichier', 'Onglets', 'Lignes lues', 'Contrôles']
      : ['File', 'Sheets', 'Rows read', 'Checks']
  return (
    <div className="b">
      <div className="lg">
        <div className="lg-r h">
          {th.map((x) => (
            <span key={x}>{x}</span>
          ))}
        </div>
        {sources.map((s) => {
          const failed = s.checks_run > 0 && s.checks_passed < s.checks_run
          return (
            <div className="lg-r" key={s.idx}>
              <span className="f" title={s.filename}>
                {s.filename}
              </span>
              <span>{s.sheets}</span>
              <span>{nf(s.rows_read, locale)}</span>
              <span className={failed ? 'ko' : 'ok'}>
                {s.checks_run === 0
                  ? locale === 'fr' ? 'aucun contrôle' : 'no checks'
                  : failed
                    ? `${s.checks_run - s.checks_passed}/${s.checks_run} ${locale === 'fr' ? 'en échec' : 'failing'}`
                    : `${s.checks_passed}/${s.checks_run} OK`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- registry */

const REGISTRY = { heading: Heading, prose: Prose, kpiGrid: KpiGrid, rail: Rail, barPair: BarPair, flag: Flag, table: Table, ledger: Ledger }

/**
 * Forward compatibility: the pipeline will always ship faster than the web
 * client. An unknown block renders a labelled placeholder so a new block type
 * degrades to a gap in the page rather than a white screen.
 */
export default function Block({ b, locale, sources }) {
  const C = REGISTRY[b.type]
  if (!C)
    return (
      <div className="b">
        <div className="unk">
          {locale === 'fr'
            ? 'Bloc non pris en charge par cette version'
            : 'Block type not supported by this version'}{' '}
          — <b>{b.type}</b>.
        </div>
      </div>
    )
  return <C b={b} locale={locale} sources={sources} />
}

export { REGISTRY }
