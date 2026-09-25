import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { dirname, basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import ExcelJS from 'exceljs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = await mkdtemp(join(root, 'node_modules', '.analytics-tests-'))
try {
  const outfile = join(tmp, 'core.cjs')
  await build({ stdin: { contents: `export * from './src/lib/analytics/import-spreadsheet'; export * from './src/lib/analytics/analytics'; export * from './src/lib/analytics/financial'; export * from './src/lib/analytics/provenance';`, resolveDir: root }, outfile, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
  const core = createRequire(import.meta.url)(outfile)
  const importText = async text => (await core.importSpreadsheet(new File([text], 'messy-sales.csv')))[0]
  const d = await importText('Sales export\nDate;Revenue;Region\n2026-01-05;1 250,50; East \nDate;Revenue;Region\n2026-02-05;2 000,00;West\n2026-02-05;2 000,00;West\n')
  assert.deepEqual(d.provenance.rows, [3, 5, 6])
  assert.equal(d.report.duplicateRows, 1)
  assert.equal(d.rows[0][1], 1250.5)
  const mapping = core.inferMapping(d.headers)
  assert.equal(core.analyze(d, mapping).total, 5250.5)
  assert.equal(core.analyze(d, { ...mapping, removeDuplicates: true }).total, 3250.5)
  const first = core.interpretRequest('Show monthly revenue', [], mapping)
  const next = core.interpretRequest('Add revenue by region', first.views, mapping)
  assert.deepEqual(first.views, ['monthly'])
  assert.deepEqual(next.views, ['monthly', 'region'])
  const analysis = core.analyze(d, mapping)
  assert.deepEqual(analysis.groups('monthly').map(p => p.sources), [['CSV data!B3'], ['CSV data!B5', 'CSV data!B6']])
  assert.deepEqual(core.interpretRequest('Ajouter les revenus par région', ['monthly'], mapping).views, ['monthly', 'region'])
  assert.equal(core.compactSources(['Sheet!C3', 'Sheet!C5', 'Sheet!C6']), 'Sheet!C3; Sheet!C5:C6')

  const mixed = await importText('Date,Revenue\n2026-01-01,USD 100\n2026-02-01,EUR 200\n')
  assert.deepEqual(core.currenciesForMeasure(mixed, core.inferMapping(mixed.headers)), ['USD', 'EUR'])
  assert(mixed.report.issues.some(i => /Mixed currencies/.test(i.message)))
  const manual = await importText('Date;Value\n2026-01-01;1 234,56\n2026-02-01;2 345,67\n')
  assert.equal(core.analyze(manual, { ...core.inferMapping(manual.headers), revenue: 'Value' }).total, 3580.23)
  const book = new ExcelJS.Workbook()
  const annual = book.addWorksheet('Annual')
  annual.addRows([['Année', 'Revenue'], [2025, 100], [2026, 200]])
  const cache = book.addWorksheet('Cached formulas')
  cache.addRows([['Date', 'Revenue'], [new Date('2026-01-01'), { formula: '1-1', result: 0 }], [new Date('2026-02-01'), 42]])
  const formatted = book.addWorksheet('Formatted currency')
  formatted.addRows([['Date', 'Revenue'], ['2026-01-01', 100], ['2026-02-01', 200]])
  formatted.getCell('B2').numFmt = '"USD" #,##0.00'
  formatted.getCell('B3').numFmt = '"EUR" #,##0.00'
  const annualFile = new File([await book.xlsx.writeBuffer()], 'years.xlsx')
  const prepared = await core.importSpreadsheet(annualFile)
  const years = prepared.find(d => d.sheet === 'Annual')
  assert.deepEqual(core.analyze(years, core.inferMapping(years.headers)).groups('yearly').map(p => p.key), ['2025', '2026'])
  const zero = prepared.find(d => d.sheet === 'Cached formulas')
  assert.equal(core.analyze(zero, core.inferMapping(zero.headers)).count, 2)
  const units = prepared.find(d => d.sheet === 'Formatted currency')
  assert.equal(core.currenciesForMeasure(units, core.inferMapping(units.headers)).length, 2)
  assert(!(await core.importSpreadsheet(annualFile, { ignoreSheets: ['Annual'] })).some(d => d.sheet === 'Annual'))
  console.log('PASS: messy CSV, original cells, duplicates, incremental/French prompts, localized numbers, numeric years, cached zero, mixed currencies and sheet exclusions.')

  const fixtureDir = process.env.LUMNIA_ANALYTICS_FIXTURE_DIR
  if (fixtureDir) await mkdir(fixtureDir, { recursive: true })
  for (const [index, path] of process.argv.slice(2).entries()) {
    const data = await core.importSpreadsheet(new File([await readFile(path)], basename(path)))
    if (/Montage_financier/i.test(path)) {
      const recap = data.find(d => /RECAP/i.test(d.sheet))
      assert(recap)
      const revenue = core.financialAnalysis(recap, core.defaultMetric(recap))
      assert.deepEqual(revenue.points.map(p => Math.round(p.value * 100) / 100), [238939, 771190, 1081920, 1539160, 2821180, 5227670])
      assert(Math.abs(revenue.total - 11680059) < .01)
      assert.equal(recap.financial.granularity, 'annual')
    }
    if (/SUIVI_FINANCES/i.test(path)) {
      const journal = data.find(d => /consolide/i.test(d.sheet.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
      assert(journal)
      const usd = core.financialAnalysis(journal, 'Cash payments · USD')
      const cdf = core.financialAnalysis(journal, 'Cash payments · CDF')
      assert.equal(usd.total, 151444)
      assert(Math.abs(cdf.total - 397209907.3076923) < .01)
      assert.equal(core.financialAnalysis(journal, 'Closing balance · USD').total, 29)
      assert(usd.insights.some(i => i.title === 'Cash balance reconciles'))
      assert(usd.points[0].sources.length > 1)
      assert(data.some(d => d.report.issues.some(i => /2024/.test(i.message) && /2026/.test(i.message))))
      assert(data.some(d => d.report.formulaErrors > 0))
    }
    if (fixtureDir) await writeFile(join(fixtureDir, `prepared-${index}.json`), JSON.stringify(data))
    console.log(`PASS: ${basename(path)} — ${data.length} detected source tables.`)
  }
} finally { await rm(tmp, { recursive: true, force: true }) }
