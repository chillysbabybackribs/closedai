import assert from 'node:assert/strict'
import test from 'node:test'
import { ContextCompactor, describeUsage, parseTokenUsage } from './context-compaction.ts'

function harness(threshold = 60) {
  const requests: Array<[string, Record<string, unknown>]> = []
  const notices: Array<[string, string]> = []
  let fail: Error | null = null
  const compactor = new ContextCompactor({
    thresholdPercent: () => threshold,
    threadId: () => 'thread-1',
    request: async (method, params) => {
      requests.push([method, params])
      if (fail) throw fail
      return {}
    },
    notice: (text, tone) => { notices.push([text, tone]) }
  })
  return { compactor, requests, notices, setFail: (error: Error) => { fail = error } }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

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

  const failed = harness(50)
  failed.setFail(new Error('unsupported'))
  failed.compactor.noteUsage({ usedTokens: 200_000, contextWindow: 258_400 })
  failed.compactor.turnFinished()
  await tick()
  assert.equal(failed.compactor.inFlight, false)
  assert.deepEqual(failed.notices.at(-1), ['Could not compact the conversation: unsupported', 'error'])
})
