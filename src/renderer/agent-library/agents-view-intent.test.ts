import assert from 'node:assert/strict'
import test from 'node:test'

import { AGENTS_VIEW_INTENT_KEY, queueAgentsViewIntent, takeAgentsViewIntent } from './agents-view-intent.ts'

test('agents view intent is queued once and consumed', () => {
  const storage = new Map<string, string>()
  const sessionStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) }
  }
  const original = globalThis.sessionStorage
  Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorage, configurable: true })
  try {
    queueAgentsViewIntent({ screen: 'build-new' })
    assert.equal(storage.get(AGENTS_VIEW_INTENT_KEY), '{"screen":"build-new"}')
    assert.deepEqual(takeAgentsViewIntent(), { screen: 'build-new' })
    assert.equal(takeAgentsViewIntent(), null)
  } finally {
    Object.defineProperty(globalThis, 'sessionStorage', { value: original, configurable: true })
  }
})
