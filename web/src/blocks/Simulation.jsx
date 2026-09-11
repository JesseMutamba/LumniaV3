import { useMemo, useRef, useState } from 'react'
import { ScenarioTab, MonteCarloTab } from 'lumnia-sim/ui'
import { DRIVERS, DEFAULT_PARAMS, hashSeed } from 'lumnia-sim'
import Prov from './Prov.jsx'
import { t } from '../lib/format.js'

/**
 * The `projection` block: the plan's own yearly rows, rendered as the
 * scenario and Monte Carlo tabs from lumnia-sim.
 *
 * The block publishes nothing simulated — every row is a Value with a cell
 * address, and everything the tabs draw is computed in this browser from
 * those rows. Renderer rule 5 says simulated figures get stamped, so the
 * stamp sits above the tab, and the Monte Carlo run prints its seed: the
 * same inputs reproduce the same distribution months later.
 */

/** A row is only usable when every figure it needs carries a source. */
const rowOk = (r) => r?.revenue?.src && r?.opex?.src && r?.capex?.src

const sessionPrefs = new Map()
const boundedParams = input => Object.fromEntries(Object.entries(DEFAULT_PARAMS).map(([key, fallback]) => [key,
  Number.isFinite(input?.[key]) && input[key] >= 0 && input[key] <= (key === 'N' ? 5000 : 100000)
    ? (key === 'N' ? Math.max(100, Math.round(input[key])) : input[key]) : fallback]))
function loadPreferences(key) {
  let raw = sessionPrefs.get(key) || {}
  try { raw = JSON.parse(localStorage.getItem(key) || JSON.stringify(raw)) } catch {}
  if (!raw || typeof raw !== 'object') raw = {}
  const custom = Object.fromEntries(DRIVERS.map(d => [d.key, Number.isFinite(raw.custom?.[d.key]) ? Math.max(d.min, Math.min(d.max, raw.custom[d.key])) : 1]))
  const seed = Number.isInteger(raw.seed) && raw.seed >= 0 && raw.seed <= 4294967295 ? raw.seed : undefined
  const lastRun = raw.lastRun && Number.isInteger(raw.lastRun.seed) && raw.lastRun.seed >= 0 && raw.lastRun.seed <= 4294967295
    ? { params: boundedParams(raw.lastRun.params), seed: raw.lastRun.seed, requestedSeed: raw.lastRun.requestedSeed ?? null } : null
  return { custom, params: boundedParams(raw.params), seed, metric: ['totalRevenue','totalMargin','finalYearMarginPct'].includes(raw.metric) ? raw.metric : 'totalRevenue', lastRun }
}

export default function Simulation(props) {
  const storageKey = 'lumnia.simulation.v2:' + (props.reportKey || 'session') + ':' + hashSeed(JSON.stringify(props.b.rows))
  return <SimulationContent key={storageKey} {...props} storageKey={storageKey} />
}

function SimulationContent({ b, locale, sources, mode, storageKey }) {
  const L = locale === 'fr'
  const [prefs, setPrefs] = useState(() => loadPreferences(storageKey))
  const prefsRef = useRef(prefs)
  const [savedHere, setSavedHere] = useState(null)
  function patchPrefs(patch) {
    const next = { ...prefsRef.current, ...patch }
    prefsRef.current = next; sessionPrefs.set(storageKey, next); setPrefs(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setSavedHere(true) } catch { setSavedHere(false) }
  }
  // The tab picker exists only where the Viewer has not already split the
  // block into two document tabs — Studio's answer surface, for instance.
  const [tab, setTab] = useState('scenario')
  const active = mode ?? tab

  const rows = useMemo(
    () =>
      ((b.rows ?? []).every(r => ['revenue','opex','capex'].every(k => r[k]?.unit === 'USD')) ? (b.rows ?? []).filter(rowOk) : []).map((r) => ({
        year: r.year,
        revenue: r.revenue.n,
        opex: r.opex.n,
        capex: r.capex.n,
        cpo: r.cpo?.n ?? 0,
      })),
    [b.rows]
  )

  const src = b.rows?.find(rowOk)?.revenue?.src

  return (
    <div className="b sim">
      <div className="sim-head">
        {!mode && (
          <div className="lens" role="tablist" aria-label={L ? 'Simulation' : 'Simulation'}>
            {[
              ['scenario', L ? 'Scénarios' : 'Scenarios'],
              ['monte', 'Monte Carlo'],
            ].map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={active === k}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="sim-stamp">
          {b.title && <b>{t(b.title, locale)} · </b>}
          {L
            ? 'Chiffres simulés dans votre navigateur à partir des cellules sources du plan — rien de simulé n’est publié.'
            : 'Figures simulated in your browser from the plan’s source cells — nothing simulated is published.'}
          <Prov src={src} sources={sources} />
        </div>
      </div>
      <div className="sim-preferences"><label>{L ? 'Graine de simulation (facultatif)' : 'Simulation seed (optional)'} <input type="number" min="0" max="4294967295" value={prefs.seed ?? ''} onChange={e => { const value = e.target.value === '' ? undefined : Number(e.target.value); if (value === undefined || Number.isInteger(value) && value >= 0 && value <= 4294967295) patchPrefs({seed:value}) }} /></label><small role="status">{savedHere === null ? (L ? 'Les modifications seront conservées dans ce navigateur.' : 'Changes will be saved in this browser.') : savedHere === false ? (L ? 'Paramètres conservés pour cette session.' : 'Settings kept for this session.') : (L ? 'Paramètres personnels conservés dans ce navigateur.' : 'Personal settings are saved in this browser.')}</small></div>
      {rows.length === 0 ? (
        <div className="unk">
          {L
            ? 'Ce modèle nécessite des montants USD et leur provenance complète. Aucune conversion automatique.'
            : 'This model requires USD monetary inputs and full source references. No currency conversion is applied.'}
        </div>
      ) : active === 'monte' ? (
        <MonteCarloTab rows={rows} locale={L ? 'fr' : 'en'} initialParams={prefs.params} initialRun={prefs.lastRun} initialMetric={prefs.metric} seed={prefs.seed} onParamsChange={params => patchPrefs({params})} onMetricChange={metric => patchPrefs({metric})} onRun={run => patchPrefs({lastRun:{params:run.params,seed:run.seed,requestedSeed:run.requestedSeed ?? null}})} />
      ) : (
        <ScenarioTab rows={rows} locale={L ? 'fr' : 'en'} initialCustom={prefs.custom} onCustomChange={custom => patchPrefs({custom})} />
      )}
    </div>
  )
}
