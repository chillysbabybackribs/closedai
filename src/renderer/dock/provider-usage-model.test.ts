import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatPlanUsage } from '../../shared/chat.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { providerUsageEntries, usageChipText, usageHeadline, usageWindowState, USAGE_STALE_MS } from './provider-usage-model.js'

const NOW = 1_800_000_000_000
function usage(percent = 38, updatedAt = NOW): ChatPlanUsage {
  return { plan: 'Pro', note: null, unavailable: null, updatedAt, windows: [
    { label: '5-hour', percent, resetsAt: NOW + 3600_000 }
  ] }
}
function row(id: string, value: ChatPlanUsage | null, email = 'a@example.test'): ChatRowSummary {
  return { paneId: id, parentPaneId: null, kind: 'peer', provider: 'codex', modelId: 'gpt', threadId: id,
    title: id, preview: '', running: false, activity: null, updatedAt: NOW, attached: true, pinnedAt: null,
    cwd: '/workspace', createdAt: NOW, lastTurnEndedAt: null,
    providerUsage: { usage: value, account: { type: 'chatgpt', email, planType: 'pro' }, connection: { state: 'ready', message: 'Ready' } } }
}

test('account quotas use the latest reading without summing chats or merging known accounts', () => {
  const entries = providerUsageEntries([row('old', usage(20, NOW - 1000)), row('new', usage(38)),
    row('other', usage(90), 'b@example.test'), { ...row('saved', usage(100)), attached: false }])
  assert.equal(entries.length, 2)
  assert.equal(entries[0].source?.paneId, 'new')
  assert.equal(usageHeadline(entries[0].usage, NOW).text, '62% left')
  assert.equal(entries[1].source?.paneId, 'other')
})

test('thresholds describe remaining allowance and scoped windows retain their name', () => {
  for (const [percent, level] of [[79, 'normal'], [80, 'low'], [90, 'critical'], [100, 'exhausted']] as const) {
    assert.equal(usageHeadline(usage(percent), NOW).level, level)
  }
  const value = usage()
  value.windows.push({ label: 'Weekly (Opus)', percent: 95, resetsAt: null })
  assert.equal(usageHeadline(value, NOW).window?.label, 'Weekly (Opus)')
  assert.equal(usageHeadline(value, NOW).text, '5% left')
})

test('passed resets and old partial windows never appear freshly replenished', () => {
  const value = usage()
  value.windows[0].resetsAt = NOW - 1
  assert.equal(usageHeadline(value, NOW).text, 'Stale')
  value.windows[0].resetsAt = null
  value.windows.push({ label: 'Weekly', percent: 1, resetsAt: null, updatedAt: NOW - USAGE_STALE_MS - 1 })
  assert.equal(usageHeadline(value, NOW).level, 'stale')
  assert.equal(usageWindowState(value.windows[0], value, NOW).level, 'normal')
})

test('unknown, missing and invalid readings never become a healthy zero', () => {
  assert.equal(usageHeadline(null, NOW).text, 'Unavailable')
  assert.equal(usageHeadline({ ...usage(), windows: [] }, NOW).level, 'unknown')
  assert.equal(usageHeadline(usage(NaN), NOW).level, 'unknown')
  assert.equal(usageHeadline({ ...usage(), unavailable: 'No usage endpoint' }, NOW).level, 'unknown')
  assert.equal(usageHeadline(usage(0, 0), NOW).level, 'stale')
})

test('codex and cursor chips name the plan when quota windows are missing', () => {
  const missing = { plan: 'Pro Lite', note: null, unavailable: 'No windows', updatedAt: NOW, windows: [] as const }
  assert.equal(usageChipText('codex', missing, null, NOW), 'Pro Lite · usage unavailable')
  assert.equal(usageChipText('cursor', { ...missing, plan: 'Pro' }, null, NOW), 'Pro · usage unavailable')
  assert.equal(usageChipText('codex', usage(28), 'prolite', NOW), '72% left')
})


test('startup includes every provider without any chat runtimes', () => {
  const entries = providerUsageEntries([], [])
  assert.deepEqual(entries.map((entry) => entry.provider), ['codex', 'claude', 'antigravity', 'cursor'])
  assert.ok(entries.every((entry) => entry.source === null))
  const loaded = providerUsageEntries([], [{ provider: 'antigravity', account: null, usage: usage(2) }])
  assert.equal(usageHeadline(loaded.find((entry) => entry.provider === 'antigravity')!.usage, NOW).text, '98% left')
})

test('account probes and chat push readings choose newest without duplicating accounts', () => {
  const chat = row('live', usage(40))
  const entries = providerUsageEntries([chat], [{ provider: 'codex', account: chat.providerUsage!.account, usage: usage(20, NOW - 1) }])
  assert.equal(entries.filter((entry) => entry.provider === 'codex').length, 1)
  assert.equal(entries[0].usage?.windows[0].percent, 40)
})
