import assert from 'node:assert/strict'
import test from 'node:test'
import type { SavedAgent } from '../../shared/agent-library.js'
import { createAgentLibraryStore } from './agent-library-store.ts'

function agent(id: string, name: string): SavedAgent {
  return { id, name, description: '', maxMinutes: null, autonomous: true, prompt: 'Go.', maxCycles: null, createdAt: 1, updatedAt: 1, lastRunAt: null, runCount: 0 }
}

test('the first subscriber primes from the list and later change events replace it', async () => {
  let listener: ((agents: SavedAgent[]) => void) | null = null
  let lists = 0
  const store = createAgentLibraryStore({
    list: async () => { lists += 1; return [agent('a', 'Repair agent')] },
    onChanged: (next) => { listener = next; return () => { listener = null } }
  })
  assert.deepEqual(store.agents(), [])
  const seen: number[] = []
  const off = store.subscribe(() => seen.push(store.agents().length))
  store.subscribe(() => {})
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(lists, 1, 'one list call primes every subscriber')
  assert.equal(store.agents()[0]?.name, 'Repair agent')
  listener!([agent('b', 'Triage bot'), agent('a', 'Repair agent')])
  assert.deepEqual(store.agents().map((entry) => entry.id), ['b', 'a'])
  assert.deepEqual(seen, [1, 2])
  off()
  listener!([])
  assert.deepEqual(seen, [1, 2], 'an unsubscribed listener is not called')
})

test('a failed prime lets the next subscriber try again', async () => {
  let attempts = 0
  const store = createAgentLibraryStore({
    list: async () => { attempts += 1; if (attempts === 1) throw new Error('not yet'); return [agent('a', 'Late')] },
    onChanged: () => () => {}
  })
  store.subscribe(() => {})()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(store.agents(), [])
  store.subscribe(() => {})
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(attempts, 2)
  assert.equal(store.agents()[0]?.name, 'Late')
})
