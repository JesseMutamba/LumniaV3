import Block from '../blocks/index.jsx'
import Prov from '../blocks/Prov.jsx'
import { fmt, t } from '../lib/format.js'

/**
 * Tableau de bord — the same report, as a wall instead of a page.
 *
 * Nothing here is computed client-side: every tile, bar and alert is lifted
 * from the published document's blocks, so each figure keeps the provenance
 * it was published with. The document remains the record; this is the lens
 * a reader opens when they want the state of things in one glance.
 */
export default function Dashboard({ rep, locale }) {
  const L = locale === 'fr'
  const kpis = rep.blocks.filter((b) => b.type === 'kpiGrid').flatMap((b) => b.items)
  const bars = rep.blocks.filter((b) => b.type === 'barPair')
  const flags = rep.blocks.filter((b) => b.type === 'flag')
  const rails = rep.blocks.filter((b) => b.type === 'rail')
  // The narration section is whatever the author labelled it — the machine
  // writes « Narration », a hand-written report may say « Lecture ».
  const NARR = ['narration', 'lecture', 'reading']
  const nIdx = rep.blocks.findIndex(
    (b) => b.type === 'heading' && NARR.includes((b.label?.fr || '').toLowerCase())
  )
  const narration = nIdx >= 0 && rep.blocks[nIdx + 1]?.type === 'prose'
    ? rep.blocks[nIdx + 1]
    : null

  const hero = kpis.find((k) => k.value.unit === 'pct') || kpis[0]
  const tiles = kpis.filter((k) => k !== hero)

  return (
    <div className="db">
      {hero && (
        <div className="db-hero" data-tone={hero.tone}>
          <div className="k">{t(hero.label, locale)}</div>
          <div className="v">{fmt(hero.value, locale)}</div>
          <div className="s">
            {t(hero.sub, locale)}
            <Prov src={hero.value.src} sources={rep.sources} />
          </div>
        </div>
      )}

      {tiles.length > 0 && (
        <Block b={{ type: 'kpiGrid', items: tiles }} locale={locale} sources={rep.sources} />
      )}

      {bars.map((b, i) => (
        <Block key={`bar${i}`} b={b} locale={locale} sources={rep.sources} />
      ))}

      {rails.map((b, i) => (
        <Block key={`rail${i}`} b={b} locale={locale} sources={rep.sources} />
      ))}

      {flags.length > 0 && (
        <div className="db-flags">
          {flags.map((b, i) => (
            <Block key={`flag${i}`} b={b} locale={locale} sources={rep.sources} />
          ))}
        </div>
      )}

      {narration && (
        <div className="db-narr">
          <div className="b-label">{L ? 'Lecture' : 'Reading'}</div>
          <p className="b-prose">{t(narration.text, locale)}</p>
        </div>
      )}

      <p className="fine">
        {L
          ? 'Chaque chiffre de ce tableau de bord provient du rapport publié et garde sa cellule source. Le document reste la référence.'
          : 'Every figure on this dashboard is lifted from the published report and keeps its source cell. The document remains the record.'}
      </p>
    </div>
  )
}

/** A report earns the dashboard lens when it has anything to pin to the wall. */
export function hasDashboard(rep) {
  return rep.blocks.some((b) =>
    b.type === 'kpiGrid' || b.type === 'barPair' || b.type === 'flag' || b.type === 'rail'
  )
}
