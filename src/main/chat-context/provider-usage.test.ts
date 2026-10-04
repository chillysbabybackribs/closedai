import assert from 'node:assert/strict'
import test from 'node:test'
import { createProviderUsageReader } from './provider-usage.js'
import type { ProviderUsageSnapshot } from '../../shared/chat.js'

test('startup probes deduplicate concurrent readers and reuse readings for a minute', async () => {
  let now = 1000
  let calls = 0
  const result: ProviderUsageSnapshot = { provider: 'codex', account: null,
    usage: { plan: 'Pro', windows: [{ label: 'Weekly', percent: 2, resetsAt: null }], note: null, unavailable: null, updatedAt: now } }
  const read = createProviderUsageReader(async () => { calls++; return result }, () => now)
  const [a, b] = await Promise.all([read('codex'), read('codex')])
  assert.equal(calls, 1)
  assert.equal(a, b)
  await read('codex')
  assert.equal(calls, 1)
  now += 60_000
  await read('codex')
  assert.equal(calls, 2)
  await read('codex', true)
  assert.equal(calls, 3)
})

test('failure preserves a dated reading and backs off retries independently per provider', async () => {
  let now = 1000
  let fail = false
  let calls = 0
  const read = createProviderUsageReader(async (provider) => {
    calls++
    if (fail) throw new Error('Signed out')
    return { provider, account: null, usage: { plan: null, windows: [], note: null, unavailable: null, updatedAt: now } }
  }, () => now)
  const first = await read('claude')
  fail = true
  now += 60_000
  assert.equal(await read('claude'), first)
  assert.equal(await read('claude'), first)
  assert.equal(calls, 2)
  assert.equal((await read('antigravity')).usage?.unavailable, 'Signed out')
  assert.equal(calls, 3)
})
