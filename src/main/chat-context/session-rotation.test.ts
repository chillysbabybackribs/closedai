import assert from 'node:assert/strict'
import test from 'node:test'
import { SessionRotator } from './session-rotation.ts'

function harness(enabled = true, threshold = 80, idleDelayMs = 0) {
  const rotations: number[] = []
  let turnActive = false
  let now = 0
  const rotator = new SessionRotator({
    enabled: () => enabled,
    thresholdPercent: () => threshold,
    thresholdTokens: () => 0,
    idleDelayMs,
    now: () => now,
    threadId: () => 'thread-1',
    turnActive: () => turnActive,
    rotate: async () => { rotations.push(now); rotator.complete() }
  })
  return { rotator, rotations, advance: (ms: number) => { now += ms }, setTurnActive: (active: boolean) => { turnActive = active } }
}

const flushAsync = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

test('session rotation waits for idle grace and rotates once after a hot turn', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness(true, 80, 15_000)
  h.rotator.noteUsage({ usedTokens: 170_000, contextWindow: 200_000 })
  h.rotator.turnFinished()
  assert.equal(h.rotator.scheduledForIdle, true)
  t.mock.timers.tick(14_999)
  assert.deepEqual(h.rotations, [])
  t.mock.timers.tick(1)
  await flushAsync()
  assert.equal(h.rotations.length, 1)
})

test('send cancels a queued rotation without waiting', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness(true, 80, 15_000)
  h.rotator.noteUsage({ usedTokens: 170_000, contextWindow: 200_000 })
  h.rotator.turnFinished()
  await h.rotator.prepareForSend()
  t.mock.timers.tick(15_000)
  await flushAsync()
  assert.deepEqual(h.rotations, [])
})

test('rotation stays off when seamless rotation is disabled', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness(false, 80, 15_000)
  h.rotator.noteUsage({ usedTokens: 190_000, contextWindow: 200_000 })
  h.rotator.turnFinished()
  t.mock.timers.tick(15_000)
  await flushAsync()
  assert.deepEqual(h.rotations, [])
})
