import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentRun, AgentRunsEvent } from '../../shared/agent-runs.js'
import { createAgentRunsStore } from './agent-runs-store.ts'

function run(chatId: string, cycle: number): AgentRun {
  return { chatId, prompt: 'Go.', status: 'running', cycle, maxCycles: null, startedAt: 1, updatedAt: 1,
    lastTurnEndedAt: null, reason: null, failures: 0, threadId: null }
}

test('the first subscriber primes from the list and later events replace it', async () => {
  let listener: ((event: AgentRunsEvent) => void) | null = null
  let lists = 0
  const store = createAgentRunsStore({
    list: async () => { lists += 1; return [run('a', 1)] },
    onEvent: (next) => { listener = next; return () => { listener = null } }
  })
  assert.equal(store.get('a'), null)
  const notified: number[] = []
  const off = store.subscribe(() => notified.push(store.runs().length))
  store.subscribe(() => {})
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(lists, 1, 'one list call primes every subscriber')
  assert.equal(store.get('a')?.cycle, 1)
  listener!({ runs: [run('a', 2), run('b', 1)] })
  assert.equal(store.get('a')?.cycle, 2)
  assert.equal(store.get('b')?.cycle, 1)
  assert.deepEqual(notified, [1, 2])
  off()
  listener!({ runs: [] })
  assert.equal(store.get('a'), null)
  assert.deepEqual(notified, [1, 2], 'an unsubscribed listener is not called')
})
