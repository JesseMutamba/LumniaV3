import assert from 'node:assert/strict'
import {parseWorkspaceRoute} from '../src/lib/workspace-routes.js'

const parse = (hash, pathname='/workspace/') => parseWorkspaceRoute({hash,pathname})
const recordViews = {r:'report',a:'authorreport',m:'myreport',published:'publication',c:'portal'}
for (const [prefix,view] of Object.entries(recordViews)) {
  const expected={view,id:'client review'}
  if (prefix==='r'||prefix==='c') expected.key='sample'
  assert.deepEqual(parse(`#/${prefix}/client%20review?k=sample`), expected)
  for (const badId of ['%', '%ZZ', '%E0%A4%A', '%C0%AF']) {
    assert.deepEqual(parse(`#/${prefix}/${badId}`), {view:'invalid'}, `${prefix} recovers from malformed encoded identifiers`)
  }
  assert.deepEqual(parse(`#/${prefix}/`), {view:'invalid'}, `${prefix} does not silently open another workspace when its ID is missing`)
}
assert.deepEqual(parse('#/published/report-123'), {view:'publication',id:'report-123'})
assert.deepEqual(parse('#/reports'), {view:'clientreports'})
assert.deepEqual(parse('#/analysis'), {view:'clientstudio'})
assert.deepEqual(parse('#/financial'), {view:'clientstudio'})
assert.deepEqual(parse('#/demo'), {view:'demo'})
assert.deepEqual(parse('#/demo', '/'), {view:'demo'})
assert.deepEqual(parse('#/studio?workspace=financial'), {view:'studio'})
assert.deepEqual(parse('#/'), {view:'clientstudio'})
assert.deepEqual(parse('#/', '/'), {view:'home'})
console.log('PASS Valid report links retain their routes and malformed or incomplete links return a recoverable invalid-link state.')
