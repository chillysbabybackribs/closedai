import assert from 'node:assert/strict'
import test from 'node:test'
import { REPAIR_FIXTURES, correctSnapshot } from './fixtures.js'
import { antigravityEvent } from './providers.js'
import { summarize, type Trial } from './run.js'

test('oracles reject initial bugs and regressions, and accept behavioral repairs', () => {
  const [launch, history] = REPAIR_FIXTURES
  for (const fixture of REPAIR_FIXTURES) assert.equal(correctSnapshot(fixture, fixture.files), false)
  const repairedLaunch = { ...launch.files, [launch.target]: launch.files[launch.target].replace('  if (!host) return windows\n', '') }
  assert.equal(correctSnapshot(launch, repairedLaunch), true)
  assert.equal(correctSnapshot(launch, { ...repairedLaunch, 'README.md': 'oops' }), false)
  const repairedHistory = { ...history.files, [history.target]: 'exports.orderRecords = records => [...records].sort((a, b) => b.updatedAt - a.updatedAt)' }
  assert.equal(correctSnapshot(history, repairedHistory), true)
  assert.equal(correctSnapshot(history, { ...repairedHistory, [history.target]: 'exports.orderRecords = records => records.sort((a, b) => b.updatedAt - a.updatedAt)' }), false)
})

test('failed runs and model mismatches cannot become speed wins', () => {
  const row: Trial = { provider: 'claude', fixture: 'history-order', repetition: 0, retrieval: false,
    requestedModel: null, observedModel: 'same', firstCorrectEditMs: 1000, elapsedMs: 1500,
    finalCorrect: true, retrievalCalls: 0, retrievalErrors: 0, error: null }
  assert.equal(summarize([row, { ...row, retrieval: true, firstCorrectEditMs: 600 }])[0].pairs[0].deltaMs, -400)
  for (const change of [{ error: 'failed' }, { finalCorrect: false }, { observedModel: 'other' }, { firstCorrectEditMs: null }]) {
    assert.equal(summarize([row, { ...row, retrieval: true, ...change }])[0].pairs[0].comparable, false)
  }
})


test('Antigravity observations use nested protocol model and result status', () => {
  assert.deepEqual(antigravityEvent({ event: 'init', init: { model: 'model-a' } }), { model: 'model-a' })
  assert.deepEqual(antigravityEvent({ event: 'result', result: { status: 'SUCCESS' } }), { done: true })
  assert.equal(antigravityEvent({ event: 'result', result: { status: 'ERROR', error: 'denied' } }).error, 'denied')
})
