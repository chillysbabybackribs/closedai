import assert from 'node:assert/strict'
import test from 'node:test'
import { ContextCompactor, describeUsage, parseTokenUsage } from './context-compaction.ts'

function harness(threshold = 60, budget = 0, idleDelayMs = 0) {
  const requests: Array<[string, Record<string, unknown>]> = []
  const notices: Array<[string, string]> = []
  let fail: Error | null = null
  let turnActive = false
  let now = 0
  const compactor = new ContextCompactor({
    thresholdPercent: () => threshold,
    thresholdTokens: () => budget,
    idleDelayMs,
    now: () => now,
    threadId: () => 'thread-1',
    turnActive: () => turnActive,
    request: async (method, params) => {
      requests.push([method, params])
      if (fail) throw fail
      return {}
    },
    notice: (text, tone) => { notices.push([text, tone]) }
  })
  return {
    compactor, requests, notices,
    setFail: (error: Error) => { fail = error },
    advance: (ms: number) => { now += ms },
    setTurnActive: (active: boolean) => { turnActive = active }
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

test('token usage is read from the last model request without reasoning output', () => {
  const usage = parseTokenUsage({
    total: { totalTokens: 7_000_000 },
    last: { totalTokens: 36_607, inputTokens: 32_635, outputTokens: 3_972, reasoningOutputTokens: 3_769 },
    modelContextWindow: 258_400
  })
  assert.deepEqual(usage, { usedTokens: 32_838, contextWindow: 258_400 })
  assert.deepEqual(describeUsage(usage), { usedTokens: 32_838, contextWindow: 258_400, percent: 13 })
  assert.equal(parseTokenUsage({ last: { totalTokens: 10 }, modelContextWindow: null }), null)
  assert.equal(parseTokenUsage(null), null)
  assert.equal(describeUsage(null), null)
})

test('the absolute trigger runs while idle, independently of window size or percent trigger', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness(0, 32_000, 15_000)
  h.compactor.noteUsage({ usedTokens: 40_000, contextWindow: 1_000_000 })
  h.compactor.turnFinished()
  assert.equal(h.compactor.scheduledForIdle, true)
  assert.equal(h.compactor.inFlight, false)
  t.mock.timers.tick(14_999)
  assert.equal(h.requests.length, 0)
  t.mock.timers.tick(1)
  assert.equal(h.requests.length, 1)
  assert.match(h.notices[0]![0], /40000 tokens \(target 32000\)/)
  h.compactor.reset()
})

test('send and provider-start cancel a queued compaction without waiting', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness(0, 32_000, 15_000)
  h.compactor.noteUsage({ usedTokens: 40_000, contextWindow: 200_000 })
  h.compactor.turnFinished()
  await h.compactor.prepareForSend()
  t.mock.timers.tick(15_000)
  assert.equal(h.requests.length, 0)
  h.compactor.turnFinished()
  h.compactor.turnStarted()
  t.mock.timers.tick(15_000)
  assert.equal(h.requests.length, 0)
  h.compactor.turnFinished()
  h.compactor.reset()
  t.mock.timers.tick(15_000)
  assert.equal(h.requests.length, 0)
})

test('token retries require cooldown and growth, using the post-compaction low watermark', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness(0, 32_000)
  const finishAt = (tokens: number) => {
    h.compactor.noteUsage({ usedTokens: tokens, contextWindow: 200_000 })
    h.compactor.turnFinished()
    t.mock.timers.tick(1)
  }
  finishAt(40_000)
  assert.equal(h.requests.length, 1)
  h.compactor.turnFinished() // compact turn ends without reducing usage
  h.advance(300_000)
  finishAt(41_000)
  assert.equal(h.requests.length, 1)
  finishAt(48_000)
  assert.equal(h.requests.length, 2)
  h.compactor.noteUsage({ usedTokens: 12_000, contextWindow: 200_000 })
  h.compactor.turnFinished()
  finishAt(32_000)
  assert.equal(h.requests.length, 2) // cooldown still applies after successful compaction
  h.advance(300_000)
  finishAt(32_000)
  assert.equal(h.requests.length, 3)
  h.compactor.reset()
})

test('window pressure bypasses token cooldown but still waits for idle grace', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness(80, 32_000, 15_000)
  h.compactor.noteUsage({ usedTokens: 40_000, contextWindow: 200_000 })
  h.compactor.turnFinished()
  t.mock.timers.tick(15_000)
  h.compactor.turnFinished()
  h.compactor.noteUsage({ usedTokens: 160_000, contextWindow: 200_000 })
  h.compactor.turnFinished()
  assert.equal(h.requests.length, 1)
  assert.equal(h.compactor.scheduledForIdle, true)
  t.mock.timers.tick(15_000)
  assert.equal(h.requests.length, 2)
  assert.equal(h.compactor.scheduledForIdle, false)
  h.compactor.reset()
})

test('an immediate follow-up cancels percentage compaction before another model call starts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness(60, 0, 15_000)
  h.compactor.noteUsage({ usedTokens: 160_000, contextWindow: 200_000 })
  h.compactor.turnFinished()
  assert.equal(h.compactor.inFlight, false)
  t.mock.timers.tick(1_000)
  await h.compactor.prepareForSend()
  t.mock.timers.tick(90_000)
  assert.equal(h.requests.length, 0)
  assert.equal(h.compactor.scheduledForIdle, false)
})

test('active turns prevent idle compaction, including a turn starting during the grace period', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = harness(0, 32_000, 15_000)
  h.compactor.noteUsage({ usedTokens: 40_000, contextWindow: 200_000 })
  h.compactor.turnFinished()
  h.setTurnActive(true)
  t.mock.timers.tick(15_000)
  assert.equal(h.requests.length, 0)
  h.compactor.turnFinished()
  assert.equal(h.compactor.scheduledForIdle, false)
})

test('a rejection from a retired compaction cannot release a new thread wait', async () => {
  const rejectors: Array<(error: Error) => void> = []
  const compactor = new ContextCompactor({
    thresholdPercent: () => 50, threadId: () => 'thread', turnActive: () => false,
    idleDelayMs: 0,
    notice: () => {}, request: () => new Promise((_, reject) => rejectors.push(reject))
  })
  const start = () => {
    compactor.noteUsage({ usedTokens: 80, contextWindow: 100 })
    compactor.turnFinished()
  }
  start()
  await tick()
  compactor.reset()
  start()
  await tick()
  rejectors[0]!(new Error('old request'))
  await tick()
  assert.equal(compactor.inFlight, true)
  rejectors[1]!(new Error('current request'))
  await tick()
  assert.equal(compactor.inFlight, false)
})

test('a turn that leaves the context past the threshold starts one compaction', async () => {
  const { compactor, requests, notices } = harness(60)
  compactor.noteUsage({ usedTokens: 160_000, contextWindow: 258_400 })
  assert.equal(compactor.inFlight, false)
  compactor.turnFinished()
  await tick()
  assert.deepEqual(requests, [['thread/compact/start', { threadId: 'thread-1' }]])
  assert.deepEqual(notices, [['Context is at 62% of the model window; compacting older history', 'info']])
  assert.equal(compactor.inFlight, true)

  // The compaction's own turn finishing settles the wait and must not start another.
  let idle = false
  void compactor.idle().then(() => { idle = true })
  compactor.turnFinished()
  await tick()
  assert.equal(idle, true)
  assert.equal(compactor.inFlight, false)
  assert.equal(requests.length, 1)

  // Still over the threshold afterwards: nothing happens until a real turn completes again.
  compactor.noteUsage({ usedTokens: 170_000, contextWindow: 258_400 })
  await tick()
  assert.equal(requests.length, 1)
  compactor.turnFinished()
  await tick()
  assert.equal(requests.length, 2)
})

test('below the threshold, with the feature off, or without a thread nothing is requested', async () => {
  const low = harness(60)
  low.compactor.noteUsage({ usedTokens: 100_000, contextWindow: 258_400 })
  low.compactor.turnFinished()
  await tick()
  assert.equal(low.requests.length, 0)

  const off = harness(0)
  off.compactor.noteUsage({ usedTokens: 250_000, contextWindow: 258_400 })
  off.compactor.turnFinished()
  await tick()
  assert.equal(off.requests.length, 0)

  const reset = harness(60)
  reset.compactor.noteUsage({ usedTokens: 250_000, contextWindow: 258_400 })
  reset.compactor.reset()
  reset.compactor.turnFinished()
  await tick()
  assert.equal(reset.requests.length, 0)
  assert.equal(reset.compactor.current, null)
})

test('a compacted notification or a failed request releases waiting sends', async () => {
  const done = harness(50)
  done.compactor.noteUsage({ usedTokens: 200_000, contextWindow: 258_400 })
  done.compactor.turnFinished()
  await tick()
  assert.equal(done.compactor.inFlight, true)
  done.compactor.compacted()
  assert.equal(done.compactor.inFlight, false)
  await done.compactor.idle()

  // Compaction reported while its own turn is still open: the turn's end releases the wait.
  const turn = harness(50)
  turn.compactor.noteUsage({ usedTokens: 200_000, contextWindow: 258_400 })
  turn.compactor.turnFinished()
  await tick()
  turn.setTurnActive(true)
  turn.compactor.compacted()
  assert.equal(turn.compactor.inFlight, true)
  turn.setTurnActive(false)
  turn.compactor.turnFinished()
  assert.equal(turn.compactor.inFlight, false)
  assert.equal(turn.requests.length, 1)

  const failed = harness(50)
  failed.setFail(new Error('unsupported'))
  failed.compactor.noteUsage({ usedTokens: 200_000, contextWindow: 258_400 })
  failed.compactor.turnFinished()
  await tick()
  assert.equal(failed.compactor.inFlight, false)
  assert.deepEqual(failed.notices.at(-1), ['Could not compact the conversation: unsupported', 'error'])
})
