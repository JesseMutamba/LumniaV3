// All formatting is locale-side. The API sends numbers; we decide how they read.

export const t = (obj, locale) =>
  !obj ? '' : locale === 'en' ? obj.en || obj.fr : obj.fr

export const nf = (n, locale, d = 0) =>
  new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n)

const money = (n, locale) =>
  locale === 'fr'
    ? `${nf(n, locale)} $`
    : `${n < 0 ? '−$' : '$'}${nf(Math.abs(n), locale)}`

/**
 * Render a Value. A Value with no src renders ∅ — never a number.
 * This is the schema guarantee showing up in the UI: if the pipeline ever
 * finds a way to emit an unsourced figure, the user sees a hole, not a lie.
 */
export function fmt(v, locale) {
  if (!v || !v.src) return '∅'
  const { n, unit } = v
  switch (unit) {
    case 'USD':
      return money(n, locale)
    case 'CDF':
      return `${nf(n, locale)} FC`
    case 'USD/t':
      return `${money(n, locale)} /t`
    case 'ratio': // a fraction: 0.402 reads 40.2 %
      return `${nf(n * 100, locale, 1)} %`
    case 'pct': // already a percentage: 39.5 reads 39.5 %
      return `${nf(n, locale, 1)} %`
    case 't':
      return `${nf(n, locale, 1)} t`
    case 'ha':
      return `${nf(n, locale)} ha`
    default:
      return nf(n, locale)
  }
}

export const signed = (v, locale) =>
  !v || !v.src ? '∅' : `${v.n > 0 ? '+' : '−'}${fmt({ ...v, n: Math.abs(v.n) }, locale)}`

export const MONTHS = {
  fr: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}
