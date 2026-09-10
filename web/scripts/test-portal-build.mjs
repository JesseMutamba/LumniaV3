/** Check preserved production pages and the bridge without a browser session. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const web = fileURLToPath(new URL('../', import.meta.url))
const root = path.resolve(web, '..')
const portal = path.join(root, 'portal')
const output = path.join(root, 'static-portal')
const hash = body => createHash('sha256').update(body).digest('hex')
const manifest = JSON.parse(await fs.readFile(path.join(portal, 'public-snapshot.json'), 'utf8'))
let passed = 0
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name) }

execFileSync(process.execPath, [path.join(web, 'scripts/build-portal.mjs')], { stdio: 'inherit' })
await test('Every captured public source retains its recorded hash', async () => {
  assert.equal(manifest.files.length, 6)
  for (const asset of manifest.files) assert.equal(hash(await fs.readFile(path.join(portal, 'public', asset.path))), asset.sha256)
})
await test('Signup, sample viewer, image and both synthetic workbooks retain exact served bytes', async () => {
  for (const asset of manifest.files.filter(asset => asset.path !== 'index.html')) {
    assert.equal(hash(await fs.readFile(path.join(output, asset.path))), asset.sha256)
  }
})
await test('The public root changes only by the workspace entry, stylesheet and bridge', async () => {
  const original = await fs.readFile(path.join(portal, 'public/index.html'), 'utf8')
  let assembled = await fs.readFile(path.join(output, 'index.html'), 'utf8')
  assert.equal((assembled.match(/id="lumnia-workspace-entry"/g) || []).length, 1)
  assert.match(assembled, /href="\/workspace\/#\/analysis"/)
  assembled = assembled.replace('<link rel="stylesheet" href="/lumnia-workspace-bridge.css">\n', '')
    .replace(/<a id="lumnia-workspace-entry"[^]*?<\/a>\n<script src="\/lumnia-workspace-bridge.js"><\/script>\n/, '')
  assert.equal(assembled, original)
})
await test('The new app stays under workspace with its built scripts and stylesheet available', async () => {
  const original = await fs.readFile(path.join(web, 'dist/index.html'), 'utf8')
  assert.equal(await fs.readFile(path.join(output, 'workspace/index.html'), 'utf8'), original)
  const references = [...original.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+)"/g)].map(match => match[1])
  assert.ok(references.length >= 2)
  for (const reference of references) await fs.access(path.join(output, 'workspace', reference))
  for (const name of ['lumnia-logo-paper.svg', 'lumnia-logo-void.svg', 'lumnia-ambient-paper.svg', 'lumnia-ambient-void.svg']) {
    assert.equal(hash(await fs.readFile(path.join(output, 'brand', name))), hash(await fs.readFile(path.join(web, 'dist/brand', name))))
  }
})

const bridge = await fs.readFile(path.join(portal, 'bridge.js'), 'utf8')
function exercise(startHash) {
  const redirects = [], entry = { hidden: false }, listeners = new Map()
  const window = { location: { hash: startHash, replace: next => redirects.push(next) }, addEventListener: (name, fn) => listeners.set(name, fn) }
  const document = { getElementById: id => { assert.equal(id, 'lumnia-workspace-entry'); return entry } }
  // No session storage is exposed here: the bridge must not read credentials.
  vm.runInNewContext(bridge, { window, document })
  return { redirects, entry, window, listeners }
}
await test('Only the new analysis paths redirect, retaining their full hash', () => {
  for (const route of ['#/analysis', '#/studio?workspace=financial', '#/financial', '#/studio']) {
    assert.deepEqual(exercise(route).redirects, ['/workspace/' + route])
  }
  for (const route of ['', '#/', '#signin', '#contact', '#/studio-other', '#/analysis-other']) {
    const result = exercise(route)
    assert.deepEqual(result.redirects, [])
    assert.equal(result.entry.hidden, false)
  }
})
await test('Existing report and portal links stay on the original viewer without an overlay', () => {
  for (const route of ['#/r/public-report?k=sample', '#/m/client-report', '#/c/estate?k=portal', '#/a/report']) {
    const result = exercise(route)
    assert.deepEqual(result.redirects, [])
    assert.equal(result.entry.hidden, true)
    result.window.location.hash = '#/'
    result.listeners.get('hashchange')()
    assert.equal(result.entry.hidden, false)
  }
})
console.log(`${passed} portal assembly checks passed.`)
