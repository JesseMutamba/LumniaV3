/** Client compatibility with the existing production portal login contract. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'lumnia-portal-client-'))
const values = new Map()
globalThis.window = { location: { origin: 'https://lumnia.example' } }
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
}
const calls = []
const legacy = {
  token: 'test-session-token', expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { username: 'client-one' }, org: { id: 'estate', name: 'Estate', sub: {} },
}
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: new URL(url, window.location.origin), options })
  return Response.json(String(url).endsWith('/auth/login') ? legacy : { ok: true })
}
let passed = 0
async function test(name, run) {
  await run()
  passed++
  console.log('PASS ' + name)
}

try {
  const outfile = path.join(temp, 'client.cjs')
  await build({
    stdin: { contents: "export * from './src/lib/api.js'; export * from './src/lib/analysis-studio-api.js'; export * from './src/lib/financial-review-api.js';", resolveDir: process.cwd() },
    outfile, bundle: true, platform: 'node', format: 'cjs',
    define: { 'import.meta.env': '{}' }, logLevel: 'silent',
  })
  const api = require(outfile)
  await test('Existing portal login response remains usable without user.org', async () => {
    api.setSession(await api.login('client-one', 'test-password'))
    assert.deepEqual(api.getSession(), legacy)
    assert.equal(api.sessionBelongsToOrg(api.getSession(), 'estate'), true)
  })
  const analysis = api.createAnalysisRequest({ principal: 'client', org: 'estate' })
  const financial = api.createFinancialRequest({ principal: 'client', org: 'estate' })
  await test('Legacy session opens the correct analysis context', async () => {
    const response = await analysis('/v1/analysis-studio/context')
    assert.equal(response.ok, true)
    assert.equal(calls.at(-1).url.searchParams.get('org'), 'estate')
    assert.equal(calls.at(-1).options.headers.get('Authorization'), 'Bearer test-session-token')
  })
  await test('Legacy session saves and opens financial reviews through the JSON adapter', async () => {
    assert.deepEqual(await financial('/v1/financial-reviews', { method: 'POST', body: '{}' }), { ok: true })
    assert.equal(calls.at(-1).url.searchParams.get('org'), 'estate')
    assert.equal(calls.at(-1).options.credentials, 'omit')
  })
  await test('Neither client adapter sends credentials to another API origin', async () => {
    const count = calls.length
    await assert.rejects(analysis('https://elsewhere.example/v1/analysis-studio/context'), /outside/)
    await assert.rejects(financial('https://elsewhere.example/v1/financial-reviews'), /outside/)
    assert.equal(calls.length, count)
  })
  await test('Another organization is still rejected for a legacy session', async () => {
    const count = calls.length
    await assert.rejects(api.createAnalysisRequest({ principal: 'client', org: 'other' })('/v1/analysis-studio/context'), /Sign in/)
    await assert.rejects(api.createFinancialRequest({ principal: 'client', org: 'other' })('/v1/financial-reviews'), /Sign in/)
    assert.equal(calls.length, count)
  })
  await test('Contradictory user and session organization fields remain rejected', async () => {
    api.setSession({ ...legacy, user: { ...legacy.user, org: 'other' } })
    await assert.rejects(analysis('/v1/analysis-studio/context'), /Sign in/)
    await assert.rejects(financial('/v1/financial-reviews'), /Sign in/)
    api.setSession(legacy)
  })
  await test('Expired sessions do not send requests', async () => {
    api.setSession({ ...legacy, expires_at: 1 })
    const count = calls.length
    await assert.rejects(analysis('/v1/analysis-studio/context'), /Sign in/)
    await assert.rejects(financial('/v1/financial-reviews'), /Sign in/)
    assert.equal(calls.length, count)
    api.setSession(legacy)
  })
  await test('Verified portal account IDs isolate saved-review resume state', () => {
    const scope = { principal: 'client', org: 'estate' }
    const first = api.financialStorageKey({ ...scope, user: { username: 'client-one', id: 'account-1' } })
    const recreated = api.financialStorageKey({ ...scope, user: { username: 'client-one', id: 'account-2' } })
    assert.notEqual(first, recreated)
    assert.throws(() => api.financialStorageKey({ ...scope, user: legacy.user }), /Verify/)
  })
  await test('Existing SQLite saved-review keys are unchanged', () => {
    const user = { username: 'client-one', created_at: '2026-09-10T00:00:00Z' }
    assert.equal(api.financialStorageKey({ principal: 'client', org: 'estate', user }),
      'lumnia-financial-last:' + JSON.stringify(['/v1/financial-reviews', 'client', 'estate', user.username, user.created_at]))
  })
  await test('Client retention settings still block saved financial data', async () => {
    const count = calls.length
    const request = api.createFinancialRequest({ principal: 'client', org: 'estate', retainFiles: false })
    await assert.rejects(request('/v1/financial-reviews', { method: 'POST', body: '{}' }), /disabled/)
    assert.equal(calls.length, count)
  })
  console.log(`${passed} portal client compatibility checks passed.`)
} finally {
  await fs.rm(temp, { recursive: true, force: true })
}
