/** Check homepage assembly and compatibility with existing report links. */
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
await test('The public homepage and legacy viewer each receive only the early routing bridge', async () => {
  for (const [source, served] of [['home/index.html', 'index.html'], ['public/index.html', 'legacy/index.html']]) {
    const original = await fs.readFile(path.join(portal, source), 'utf8')
    const assembled = await fs.readFile(path.join(output, served), 'utf8')
    const injection = '\n<script src="/lumnia-workspace-bridge.js"></script>'
    assert.equal((assembled.match(/src="\/lumnia-workspace-bridge.js"/g) || []).length, 1)
    assert.match(assembled, /<head(?:\s[^>]*)?>\n<script src="\/lumnia-workspace-bridge.js"><\/script>/i)
    assert.equal(assembled.replace(injection, ''), original)
    assert.doesNotMatch(assembled, /id="lumnia-workspace-entry"/)
  }
  for (const filename of ['home.css', 'home.js']) {
    assert.equal(await fs.readFile(path.join(output, filename), 'utf8'), await fs.readFile(path.join(portal, 'home', filename), 'utf8'))
  }
  assert.equal(await fs.readFile(path.join(output, 'lumnia-workspace-bridge.js'), 'utf8'), await fs.readFile(path.join(portal, 'bridge.js'), 'utf8'))
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
function exercise(startHash, pathname = '/') {
  const redirects = [], listeners = new Map()
  const window = { location: { pathname, hash: startHash, replace: next => redirects.push(next) }, addEventListener: (name, fn) => listeners.set(name, fn) }
  // No DOM or session storage is exposed here: routing must work before page
  // rendering and must not read credentials.
  vm.runInNewContext(bridge, { window })
  return { redirects, window, listeners }
}
await test('Workspace and published-review entry paths redirect with their full hash from either page', () => {
  for (const pathname of ['/', '/legacy/', '/legacy/index.html']) {
    for (const route of ['#/analysis', '#/studio?workspace=financial', '#/financial', '#/studio', '#/reports', '#/published/report-123', '#/published/client%20review', '#/published/%E0%A4%A']) {
      assert.deepEqual(exercise(route, pathname).redirects, ['/workspace/' + route])
    }
    assert.deepEqual(exercise('#signin', pathname).redirects, ['/workspace/#/analysis'])
  }
})
await test('Homepage section anchors stay on the homepage and unrelated route names do not redirect', () => {
  for (const route of ['', '#/', '#contact', '#/studio-other', '#/analysis-other', '#/published-other']) {
    assert.deepEqual(exercise(route).redirects, [])
  }
})
await test('Existing report and portal links open the preserved viewer without losing identifiers or share keys', () => {
  for (const route of ['#/r/public-report?k=sample', '#/m/client-report', '#/c/estate?k=portal', '#/a/report', '#/r/encoded%20id?k=a%2Bb%3D', '#/r/%E0%A4%A?k=sample']) {
    assert.deepEqual(exercise(route).redirects, ['/legacy/' + route])
    for (const pathname of ['/legacy/', '/legacy/index.html']) {
      assert.deepEqual(exercise(route, pathname).redirects, [])
    }
  }
})
await test('Legacy home links return to the current homepage, including after a hash change', () => {
  for (const route of ['', '#/']) assert.deepEqual(exercise(route, '/legacy/').redirects, ['/'])
  assert.deepEqual(exercise('#contact', '/legacy/').redirects, ['/#contact'])
  const result = exercise('#/m/client-report', '/legacy/')
  result.window.location.hash = '#/'
  result.listeners.get('hashchange')()
  assert.deepEqual(result.redirects, ['/'])
})
await test('Hash navigation from the homepage can still open an existing shared report', () => {
  const result = exercise('#/')
  result.window.location.hash = '#/r/public-report?k=sample'
  result.listeners.get('hashchange')()
  assert.deepEqual(result.redirects, ['/legacy/#/r/public-report?k=sample'])
})
console.log(`${passed} portal assembly checks passed.`)
