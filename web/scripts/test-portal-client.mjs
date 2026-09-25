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
  if (String(url).endsWith('/auth/logout')) return new Response(null, { status: 204 })
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
    stdin: { contents: "export * from './src/lib/api.js'; export * from './src/lib/analysis-studio-api.js'; export * from './src/lib/financial-review-api.js'; export * from './src/lib/review-publication-api.js';", resolveDir: process.cwd() },
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
  await test('Malformed persisted session identities cannot reach the workspace', () => {
    for (const session of [null, [], { ...legacy, user: null }, { ...legacy, user: {} },
      { ...legacy, user: { username: ' ' } }, { ...legacy, org: null }, { ...legacy, org: { id: '' } },
      { ...legacy, token: {} }, { ...legacy, expires_at: 'never' }, { ...legacy, expires_at: null }]) {
      values.set('lumnia.session', JSON.stringify(session))
      assert.equal(api.getSession(), null)
    }
    values.set('lumnia.session', '{broken json')
    assert.equal(api.getSession(), null)
    api.setSession(legacy)
  })
  await test('Removing the session in another tab does not revive the memory copy', () => {
    api.setSession(legacy)
    values.delete('lumnia.session')
    assert.equal(api.getSession(), null)
    api.setSession(legacy)
  })
  await test('Published report requests bind the current account and organization', async () => {
    const request = api.createPublicationRequest({ org: 'estate' })
    const controller = new AbortController()
    const body = JSON.stringify({ review_id: 'saved-review', expected_version: 3 })
    await request(api.publicationApiBase + '?org=other&status=published', {
      method: 'POST', body, signal: controller.signal, credentials: 'include',
      headers: { Authorization: 'Bearer untrusted-caller-token', 'Content-Type': 'application/json' },
    })
    const { url, options } = calls.at(-1)
    assert.equal(url.pathname, '/v1/review-publications')
    assert.equal(url.searchParams.get('org'), 'estate')
    assert.equal(url.searchParams.get('status'), 'published')
    assert.equal(options.headers.get('Authorization'), 'Bearer test-session-token')
    assert.equal(options.headers.get('Content-Type'), 'application/json')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.signal, controller.signal)
    assert.equal(options.body, body)
  })
  await test('Publication credentials cannot escape by origin, sibling path or path normalization', async () => {
    const request = api.createPublicationRequest({ org: 'estate' })
    const count = calls.length
    for (const url of ['https://elsewhere.example/v1/review-publications',
      '//elsewhere.example/v1/review-publications', '/v1/review-publications-lookalike',
      '/v1/review-publications/../auth/login', '/v1/review-publications/%2e%2e/auth/login',
      '/v1/financial-reviews', 'http://lumnia.example/v1/review-publications']) {
      await assert.rejects(request(url), /outside the configured API/)
    }
    assert.equal(calls.length, count)
    assert.throws(() => api.createPublicationRequest({ org: '' }), /Select your client workspace/)
  })
  await test('Publication sessions refresh between calls and reject expired or mismatched accounts locally', async () => {
    let expired = 0
    const request = api.createPublicationRequest({ org: 'estate', onExpired: () => expired++ })
    const renewed = { ...legacy, token: 'renewed-client-token' }
    api.setSession(renewed)
    await request(api.publicationApiBase)
    assert.equal(calls.at(-1).options.headers.get('Authorization'), 'Bearer renewed-client-token')
    const count = calls.length
    for (const session of [null, { ...legacy, expires_at: 1 },
      { ...legacy, org: { id: 'other' } }, { ...legacy, user: { ...legacy.user, org: 'other' } }]) {
      api.setSession(session)
      await assert.rejects(request(api.publicationApiBase), error => error.status === 401 && /Sign in/.test(error.message))
    }
    assert.equal(expired, 4)
    assert.equal(calls.length, count)
    api.setSession(legacy)
  })
  await test('Server expiration and version conflicts produce distinct report errors', async () => {
    const ordinaryFetch = globalThis.fetch
    let expired = 0
    const request = api.createPublicationRequest({ org: 'estate', onExpired: () => expired++ })
    try {
      globalThis.fetch = async () => Response.json({ detail: 'Sign in again.' }, { status: 401 })
      await assert.rejects(request(api.publicationApiBase), error => error.status === 401 && error.message === 'Sign in again.')
      assert.equal(expired, 1)
      globalThis.fetch = async () => Response.json({ detail: 'Refresh Reports before deleting.' }, { status: 409 })
      await assert.rejects(request(api.publicationApiBase + '/report', { method: 'DELETE' }),
        error => error.status === 409 && error.message === 'Refresh Reports before deleting.')
      assert.equal(expired, 1)
    } finally {
      globalThis.fetch = ordinaryFetch
    }
  })
  await test('Report validation and malformed server responses become readable errors', async () => {
    const ordinaryFetch = globalThis.fetch
    const request = api.createPublicationRequest({ org: 'estate' })
    try {
      globalThis.fetch = async () => Response.json({ detail: [{ msg: 'Review version is required.' }, { msg: 'Select a saved review.' }] }, { status: 422 })
      await assert.rejects(request(api.publicationApiBase), error => error.status === 422
        && error.message === 'Review version is required.; Select a saved review.')
      for (const status of [200, 502]) {
        globalThis.fetch = async () => new Response('<html>Unexpected upstream response</html>', { status })
        await assert.rejects(request(api.publicationApiBase), error => error.status === status
          && /couldn’t be completed/.test(error.message) && !error.message.includes('<html>'))
      }
    } finally {
      globalThis.fetch = ordinaryFetch
    }
  })
  await test('Successful permanent report deletion accepts 204 without parsing a JSON body', async () => {
    const ordinaryFetch = globalThis.fetch
    const request = api.createPublicationRequest({ org: 'estate' })
    let parsed = false
    let sent
    try {
      globalThis.fetch = async (url, options) => {
        sent = { url: new URL(url), options }
        return { status: 204, ok: true, json() { parsed = true; throw new Error('No JSON body on 204') } }
      }
      assert.equal(await request(api.publicationApiBase + '/report?expected_version=4', { method: 'DELETE' }), null)
      assert.equal(parsed, false)
      assert.equal(sent.url.searchParams.get('expected_version'), '4')
      assert.equal(sent.url.searchParams.get('org'), 'estate')
      assert.equal(sent.options.method, 'DELETE')
      assert.equal(sent.options.headers.get('Authorization'), 'Bearer test-session-token')
    } finally {
      globalThis.fetch = ordinaryFetch
    }
  })
  await test('A configured external publication API uses only its own credential boundary', async () => {
    const customFile = path.join(temp, 'external-publications.cjs')
    await build({
      stdin: { contents: "export * from './src/lib/review-publication-api.js';", resolveDir: process.cwd() },
      outfile: customFile, bundle: true, platform: 'node', format: 'cjs',
      define: { 'import.meta.env': JSON.stringify({ VITE_API: 'https://api.lumnia.example/api/v2/' }) }, logLevel: 'silent',
    })
    const custom = require(customFile)
    const request = custom.createPublicationRequest({ org: 'estate' })
    assert.equal(custom.publicationApiBase, 'https://api.lumnia.example/api/v2/review-publications')
    await request(custom.publicationApiBase + '/report')
    assert.equal(calls.at(-1).url.origin, 'https://api.lumnia.example')
    assert.equal(calls.at(-1).options.headers.get('Authorization'), 'Bearer test-session-token')
    const count = calls.length
    await assert.rejects(request('/api/v2/review-publications'), /outside the configured API/)
    await assert.rejects(request('https://api.lumnia.example/api/v2/auth/login'), /outside the configured API/)
    assert.equal(calls.length, count)
  })
  await test('Explicit sign-out revokes the captured client token after local state clears', async () => {
    const captured = api.getSession()
    api.setToken('separate-author-token')
    api.setSession(null)
    assert.equal(await api.logout(captured), null)
    const { url, options } = calls.at(-1)
    assert.equal(url.pathname, '/v1/auth/logout')
    assert.equal(options.method, 'POST')
    assert.equal(options.credentials, 'omit')
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer test-session-token')
    assert.equal(api.getSession(), null)
    const count = calls.length
    assert.equal(await api.logout(), null)
    assert.equal(calls.length, count)
    api.setToken('')
  })
  await test('Unavailable browser storage still supports this page session and sign-out', () => {
    const workingStorage = globalThis.localStorage
    globalThis.localStorage = {
      getItem() { throw new Error('Storage unavailable') },
      setItem() { throw new Error('Storage unavailable') },
      removeItem() { throw new Error('Storage unavailable') },
    }
    try {
      api.setSession(legacy)
      assert.deepEqual(api.getSession(), legacy)
      api.setSession({ ...legacy, user: null })
      assert.equal(api.getSession(), null)
      api.setSession(null)
      assert.equal(api.getSession(), null)
    } finally {
      globalThis.localStorage = workingStorage
      api.setSession(null)
    }
  })
  console.log(`${passed} portal client compatibility checks passed.`)
} finally {
  await fs.rm(temp, { recursive: true, force: true })
}
