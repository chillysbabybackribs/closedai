import assert from 'node:assert/strict'
import test from 'node:test'
import { IdleProcessGuard } from './idle-process-guard.js'

test('reads the configured timeout each time it arms and cancels when busy', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let delay = 100
  let stopped = 0
  const guard = new IdleProcessGuard(() => stopped++, () => delay)
  guard.schedule(true)
  context.mock.timers.tick(99)
  assert.equal(stopped, 0)
  context.mock.timers.tick(1)
  assert.equal(stopped, 1)
  delay = 300
  guard.schedule(true)
  context.mock.timers.tick(100)
  assert.equal(stopped, 1)
  guard.schedule(false)
  context.mock.timers.tick(300)
  assert.equal(stopped, 1)
})
