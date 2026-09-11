import assert from 'node:assert/strict'
import { BEFORE_WORKSPACE_NAVIGATION, subscribeWorkspaceNavigation } from '../src/lib/workspace-navigation.js'

const target = new EventTarget()
target.CustomEvent = CustomEvent
target.location = {hash:'#/analysis', pathname:'/workspace/', search:''}
target.history = {replaceState(_state, _unused, url) {target.location.hash = url.slice(url.indexOf('#'))}}
const routes = []
const unsubscribe = subscribeWorkspaceNavigation(() => routes.push(target.location.hash), target)
const navigate = hash => {target.location.hash=hash;target.dispatchEvent(new Event('hashchange'))}
let pending
const unsaved = event => {event.preventDefault();pending=event.detail.proceed}
target.addEventListener(BEFORE_WORKSPACE_NAVIGATION, unsaved)

navigate('#/reports')
assert.equal(target.location.hash, '#/analysis', 'Back/Forward restores the current workspace until the user decides')
assert.deepEqual(routes, [], 'Dirty workspace stays mounted')
pending()
target.dispatchEvent(new Event('hashchange'))
assert.deepEqual(routes, ['#/reports'], 'Save/continue proceeds once without a second prompt')
target.removeEventListener(BEFORE_WORKSPACE_NAVIGATION, unsaved)
navigate('#/analysis')
assert.deepEqual(routes, ['#/reports', '#/analysis'], 'Clean navigation proceeds normally')
unsubscribe()
navigate('#/reports')
assert.equal(routes.length, 2, 'Unmount removes the history listener')
console.log('PASS Workspace history preserves unsaved changes and resumes approved navigation.')
