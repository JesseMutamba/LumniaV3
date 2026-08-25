import { useMemo, useState } from 'react'
import { ScenarioTab, MonteCarloTab } from 'lumnia-sim/ui'
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

export default function Simulation({ b, locale, sources, mode }) {
  const L = locale === 'fr'
  // The tab picker exists only where the Viewer has not already split the
  // block into two document tabs — Studio's answer surface, for instance.
  const [tab, setTab] = useState('scenario')
  const active = mode ?? tab

  const rows = useMemo(
    () =>
      (b.rows ?? []).filter(rowOk).map((r) => ({
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
      {rows.length === 0 ? (
        <div className="unk">
          {L
            ? 'Projection sans provenance complète — rien à simuler.'
            : 'Projection missing full provenance — nothing to simulate.'}
        </div>
      ) : active === 'monte' ? (
        <MonteCarloTab rows={rows} locale={L ? 'fr' : 'en'} />
      ) : (
        <ScenarioTab rows={rows} locale={L ? 'fr' : 'en'} />
      )}
    </div>
  )
}
