import { useRef, useState } from 'react'
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

function KpiCard({ it, locale, sources }) {
  const [open, setOpen] = useState(false)
  const L = locale === 'fr'
  const deep = it.lineage?.length > 0 || it.definition || it.methodology
  const src = it.value.src
  const file = sources?.[src?.file]?.filename
  return (
    <div className="kpi">
      <div className="k">{t(it.label, locale)}</div>
      <div className={`v ${it.tone}`}>
        {it.value.derived === 'delta' ? signed(it.value, locale) : fmt(it.value, locale)}
      </div>
      <div className="s">
        {t(it.sub, locale)}
        <Prov src={src} sources={sources} />
      </div>
      {deep && (
        <button className="link drill-t" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? (L ? 'fermer' : 'close') : (L ? 'approfondir' : 'dive deeper')}
        </button>
      )}
      {open && (
        <div className="drill">
          {it.definition && <p className="drill-def">{t(it.definition, locale)}</p>}
          {it.methodology && <p className="drill-meth">{t(it.methodology, locale)}</p>}
          {it.lineage?.length > 0 && (
            <ol className="drill-steps">
              {it.lineage.map((s, i) => (
                <li key={i}>
                  <span>{t(s.text, locale)}</span>
                  <span className="drill-nums">
                    {s.cells && <code>{s.cells}</code>}
                    {s.n != null && <b>{nf(s.n, locale, Number.isInteger(s.n) ? 0 : 1)}</b>}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {file && (
            <div className="drill-src">
              {L ? 'source' : 'source'} : {file} › {src.sheet} › {src.cells}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const KpiGrid = ({ b, locale, sources }) => (
  <div className="b">
    <div className="kpis">
      {b.items.map((it, i) => (
        <KpiCard key={i} it={it} locale={locale} sources={sources} />
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
            <span className="sw sw-env" />
            {locale === 'fr' ? 'Enveloppe' : 'Envelope'}
          </i>
          <i>
            <span className="sw sw-act" />
            {locale === 'fr' ? 'Réel' : 'Actual'}
          </i>
          <i>
            <span className="sw sw-pace" />
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


/* ------------------------------------------------------------- tooltips
   SVG's own <title> waits about a second, cannot be styled, and never
   appears on a touch screen. A chart whose numbers are only available to a
   patient reader with a mouse is a chart that does not show its numbers.

   Pointer events rather than mouse events, so a tap on a phone works the
   same way as a hover on a laptop. */
function useTip() {
  const box = useRef(null)
  const [tip, setTip] = useState(null)
  const show = (e, rows) => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, rows })
  }
  return { box, tip, show, hide: () => setTip(null) }
}

function Tip({ tip }) {
  if (!tip) return null
  // Clamped so a bar at either edge does not push the box out of the card.
  const left = Math.min(Math.max(tip.x, 66), tip.w - 66)
  return (
    <div className="tip" style={{ left, top: tip.y }} role="status">
      {tip.rows.map((r, i) => (
        <div key={i} className={i === 0 ? 'tip-k' : 'tip-r'}>
          {i === 0 ? r : (<><span>{r[0]}</span><b>{r[1]}</b></>)}
        </div>
      ))}
    </div>
  )
}

/* --------------------------------------------------------------- barPair */

function BarPair({ b, locale, sources }) {
  const { box, tip, show, hide } = useTip()
  // A chart shows the shape; a table lets someone check the figure. Anyone
  // asked to sign off on a number wants the second, and the cell address
  // beside it — so the table view is where provenance earns its keep.
  const [asTable, setAsTable] = useState(false)
  const x = b.x === 'months' ? MONTHS[locale] : b.x
  const [plan, act] = b.series
  const vals = (s) => (s ? s.values.map((v) => v.n) : [])
  // The viewBox is the chart's own coordinate space, and SVG text scales
  // with it. At 960 units wide inside a half-width panel, 9.5px axis labels
  // land at about 4.6 real pixels — present, and unreadable. Keeping the box
  // near the rendered width keeps the type near its stated size.
  const W = 600,
    H = 250,
    P = { t: 14, r: 10, b: 28, l: 58 }
  const iw = W - P.l - P.r,
    ih = H - P.t - P.b
  const bw = iw / x.length,
    gap = bw * 0.22,
    w = (bw - gap) / 2
  // A balance row goes negative, and a bar clamped to zero height reads as
  // "nothing happened" rather than "we lost money". The scale carries zero
  // whenever any value is below it.
  const all = [...vals(plan), ...vals(act)]
  const hi = Math.max(0, ...all) * 1.12
  const lo = Math.min(0, ...all) * 1.12
  const span = hi - lo || 1
  const y = (v) => P.t + ih - ((v - lo) / span) * ih
  const zero = y(0)
  const lab = (v) => (b.fmt === 'k' ? `${nf(v / 1000, locale)}k` : nf(v, locale))

  return (
    <div className="b">
      <div className="card chart" ref={box}>
        <Tip tip={tip} />
        <div className="card-h">
          <span>
            {t(b.title, locale)}
            <Prov src={plan?.values?.[0]?.src} sources={sources} />
          </span>
          <span className="key">
            {!asTable && (
              <>
                <i>
                  <span className="sw sw-plan" />
                  {t(plan?.label, locale) || 'Budget'}
                </i>
                {act && (
                  <i>
                    <span className="sw sw-actg" />
                    {t(act.label, locale) || (locale === 'fr' ? 'Réel' : 'Actual')}
                  </i>
                )}
              </>
            )}
            <button
              className="viewtog"
              aria-pressed={asTable}
              onClick={() => setAsTable(!asTable)}
              title={
                locale === 'fr'
                  ? 'Basculer entre le graphique et les chiffres'
                  : 'Switch between the chart and the figures'
              }
            >
              {asTable
                ? locale === 'fr' ? 'graphique' : 'chart'
                : locale === 'fr' ? 'chiffres' : 'figures'}
            </button>
          </span>
        </div>
        {b.sub && <div className="card-s">{t(b.sub, locale)}</div>}
        {asTable ? (
          <BarTable b={b} x={x} plan={plan} act={act} locale={locale} sources={sources} />
        ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={t(b.title, locale)}
          className="clickable"
          onClick={() => setAsTable(true)}
        >
          {[1, 2, 3, 4].map((i) => {
            const v = lo + (span * i) / 4
            return (
              <g key={i}>
                <line className="gl" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} />
                <text className="ax" x={P.l - 8} y={y(v) + 3.5} textAnchor="end">
                  {lab(v)}
                </text>
              </g>
            )
          })}
          <line className="base" x1={P.l} x2={W - P.r} y1={zero} y2={zero} />
          <text className="ax" x={P.l - 8} y={zero + 3.5} textAnchor="end">
            {lab(0)}
          </text>
          {x.map((m, i) => {
            const x0 = P.l + i * bw + gap / 2
            const p = plan?.values[i]?.n
            const a = act?.values[i]?.n
            return (
              <g key={m + i}>
                {p !== undefined && (
                  <rect
                    x={x0}
                    y={Math.min(y(p), zero)}
                    width={w}
                    height={Math.max(1, Math.abs(zero - y(p)))}
                    className={`bar-plan ${p < 0 ? 'neg' : ''}`}
                    onPointerEnter={(e) => show(e, [m, [t(plan?.label, locale) || 'Budget', fmt(plan.values[i], locale)]])}
                    onPointerMove={(e) => show(e, [m, [t(plan?.label, locale) || 'Budget', fmt(plan.values[i], locale)]])}
                    onPointerLeave={hide}
                  />
                )}
                {a !== undefined && (
                  <rect
                    x={x0 + w}
                    y={Math.min(y(a), zero)}
                    width={w}
                    height={Math.max(1, Math.abs(zero - y(a)))}
                    className={`bar-act ${a < 0 ? 'neg' : ''}`}
                    onPointerEnter={(e) => show(e, [m, [t(act?.label, locale) || (locale === 'fr' ? 'Réel' : 'Actual'), fmt(act.values[i], locale)]])}
                    onPointerMove={(e) => show(e, [m, [t(act?.label, locale) || (locale === 'fr' ? 'Réel' : 'Actual'), fmt(act.values[i], locale)]])}
                    onPointerLeave={hide}
                  />
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
        )}
      </div>
    </div>
  )
}

/**
 * The figures behind a chart, each with the cell it came from.
 *
 * Where two series are plotted the variance column is the point: budget
 * against actual is the comparison every reader is actually making, and
 * doing that subtraction in your head off a bar chart is how people get it
 * wrong.
 */
function BarTable({ b, x, plan, act, locale, sources }) {
  const L = locale === 'fr'
  const cell = (v) =>
    v == null ? (
      <span className="dash">—</span>
    ) : (
      <>
        {fmt(v, locale)}
        <Prov src={v.src} sources={sources} />
      </>
    )
  // Quantities add up. Rates do not: three months at $593/t is not
  // $1,779/t, and a column of percentages summed is nonsense. Where the
  // series carries a rate there is no honest total to show, and the
  // numerator and denominator that would give one are not in this block —
  // so the row is left off rather than filled with a plausible number.
  const unit = plan?.values?.[0]?.unit ?? 'none'
  const ADDITIVE = new Set(['USD', 'CDF', 't', 'ha', 'count'])
  const addable = ADDITIVE.has(unit)
  const totalOf = (s) =>
    s ? s.values.reduce((a, v) => a + (v?.n ?? 0), 0) : null
  const tot = (n) =>
    n == null ? '' : fmt({ n, unit, src: { file: 0, sheet: '', cells: '' } }, locale)

  return (
    <div className="scroll bartable">
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>{b.x === 'months' ? (L ? 'Mois' : 'Month') : (L ? 'Période' : 'Period')}</th>
            {plan && <th>{t(plan.label, locale) || 'Budget'}</th>}
            {act && <th>{t(act.label, locale) || (L ? 'Réel' : 'Actual')}</th>}
            {plan && act && <th>{L ? 'Écart' : 'Variance'}</th>}
          </tr>
        </thead>
        <tbody>
          {x.map((m, i) => {
            const p = plan?.values[i]
            const a = act?.values[i]
            const d = p && a ? a.n - p.n : null
            return (
              <tr key={m + i}>
                <td style={{ textAlign: 'left' }}>{m}</td>
                {plan && <td>{cell(p)}</td>}
                {act && <td>{cell(a)}</td>}
                {plan && act && (
                  <td className={d < 0 ? 'neg' : d > 0 ? 'pos' : ''}>
                    {d == null ? <span className="dash">—</span> : (d > 0 ? '+' : '') + tot(d)}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
        {addable && (
        <tfoot>
          <tr>
            <td style={{ textAlign: 'left' }}>{L ? 'Total' : 'Total'}</td>
            {plan && <td>{tot(totalOf(plan))}</td>}
            {act && <td>{tot(totalOf(act))}</td>}
            {plan && act && (
              <td className={totalOf(act) - totalOf(plan) < 0 ? 'neg' : 'pos'}>
                {totalOf(act) - totalOf(plan) > 0 ? '+' : ''}
                {tot(totalOf(act) - totalOf(plan))}
              </td>
            )}
          </tr>
        </tfoot>
        )}
      </table>
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
    {/* A bare "Source" label with nothing after it promises provenance and
        then withholds it. A table of prose has no cells to point at. */}
    {b.rows?.some((r) => b.columns.some((c) => r[c.key]?.src)) && (
      <div className="src-note">
        {locale === 'fr' ? 'Source' : 'Source'}
        <Prov
          src={b.columns.map((c) => b.rows[0]?.[c.key]?.src).find(Boolean)}
          sources={sources}
        />
      </div>
    )}
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
