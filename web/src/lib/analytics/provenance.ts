/** Compact an exact set of cell addresses without claiming intervening cells. */
export function compactSources(refs: string[]): string {
  const groups = new Map<string, Set<number>>();
  const other = new Set<string>();
  for (const ref of refs) {
    const match = ref.match(/^(.*!)([A-Z]+)(\d+)$/);
    if (!match) { if (ref) other.add(ref); continue; }
    const key = match[1] + match[2];
    const rows = groups.get(key) || new Set<number>();
    rows.add(Number(match[3])); groups.set(key, rows);
  }
  const out = [...other];
  for (const [key, rows] of groups) {
    const sorted = [...rows].sort((a, b) => a - b);
    let start = sorted[0], end = start;
    const add = () => out.push(start === end ? `${key}${start}` : `${key}${start}:${key.slice(key.lastIndexOf('!') + 1)}${end}`);
    for (const row of sorted.slice(1)) {
      if (row === end + 1) end = row;
      else { add(); start = end = row; }
    }
    add();
  }
  return out.join('; ');
}

export function columnName(index: number): string {
  let out = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    out = String.fromCharCode(65 + (n - 1) % 26) + out;
  return out;
}
