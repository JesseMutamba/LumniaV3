/**
 * The provenance chip. Every number on screen is one hover away from its
 * source cell. This component is small on purpose — it is the product claim,
 * so it should be impossible to forget to use.
 */
export default function Prov({ src, sources }) {
  if (!src) return null
  const file = sources?.[src.file]?.filename ?? '?'
  const full = `${file} › ${src.sheet} › ${src.cells}`
  return (
    <button className="prov" title={full} aria-label={`Source: ${full}`}>
      {src.cells}
    </button>
  )
}
