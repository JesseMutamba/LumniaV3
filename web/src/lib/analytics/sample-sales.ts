/** Synthetic, deterministic sales data used only for the clearly labeled demo. */
export function sampleSalesFile(): File {
  const rows: string[][] = [['Lumnia synthetic sales example'], [], ['Order ID', 'Order Date', 'Revenue (USD)', 'Region', 'Product']];
  const regions = ['North', 'South', 'East', 'West'];
  const products = ['Essentials', 'Professional', 'Enterprise'];
  for (let month = 1; month <= 12; month++) for (let r = 0; r < regions.length; r++) for (let p = 0; p < products.length; p++) {
    const amount = 900 + month * 137 + r * 223 + p * 461 + ((month * 17 + r * 31) % 130);
    rows.push([`S-${month}-${r}-${p}`, `2025-${String(month).padStart(2, '0')}-${String(5 + p * 7).padStart(2, '0')}`, amount.toFixed(2).replace('.', ','), ` ${regions[r]} `, products[p]]);
  }
  rows.splice(40, 0, [...rows[2]]);
  rows.push([...rows[10]], [...rows[11]], []);
  const csv = rows.map(row => row.map(value => '"' + value.replace(/"/g, '""') + '"').join(',')).join('\r\n');
  return new File([csv], 'Lumnia_sample_sales.csv', { type: 'text/csv' });
}
