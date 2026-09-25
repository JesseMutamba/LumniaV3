import { useId, useState } from 'react'
export default function Prov({ src, sources }) {
  const [open, setOpen] = useState(false), id = useId()
  if (!src) return null
  const file = sources?.find(s => s.idx === src.file)?.filename ?? sources?.[src.file]?.filename ?? '?'
  const full = `${file} › ${src.sheet} › ${src.cells}`
  return <><button type="button" className="prov" title={full} aria-label={`Source: ${full}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>{src.cells}</button><span id={id} hidden={!open} style={{whiteSpace:'normal',overflowWrap:'anywhere',fontSize:'0.875rem'}}>{full}</span></>
}
