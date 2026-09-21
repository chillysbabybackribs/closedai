import assert from 'node:assert/strict'
import test from 'node:test'
import { settleWithin } from './app-quit.js'

test('resolves settled once every entry settles, including rejections and undefined slots', async () => {
  const outcome = await settleWithin([Promise.resolve(1), Promise.reject(new Error('flush failed')), undefined], 1_000)
  assert.equal(outcome, 'settled')
})

test('resolves timed-out when an entry never settles', async () => {
  const started = Date.now()
  const outcome = await settleWithin([new Promise(() => {})], 20)
  assert.equal(outcome, 'timed-out')
  assert.ok(Date.now() - started >= 15)
})

test('an empty flush settles immediately', async () => {
  assert.equal(await settleWithin([], 1_000), 'settled')
})
