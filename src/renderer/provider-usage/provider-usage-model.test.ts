import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatPlanUsage } from '../../shared/chat.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import {
  providerUsageEntries, roughSpan, spanNote, tightestUsage, usageHeadline, usagePace, usageVerdict, usageWindowDuration,
  usageWindowState, USAGE_STALE_MS
} from './provider-usage-model.js'

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
  assert.equal(usageHeadline(entries[0].usage, NOW).text, '62% remaining')
  assert.equal(usageHeadline(entries[0].usage, NOW).remaining, 62)
  assert.equal(entries[1].source?.paneId, 'other')
})

test('thresholds describe remaining allowance and scoped windows retain their name', () => {
  for (const [percent, level] of [[79, 'normal'], [80, 'low'], [90, 'critical'], [100, 'exhausted']] as const) {
    assert.equal(usageHeadline(usage(percent), NOW).level, level)
  }
  const value = usage()
  value.windows.push({ label: 'Weekly (Opus)', percent: 95, resetsAt: null })
  assert.equal(usageHeadline(value, NOW).window?.label, 'Weekly (Opus)')
  assert.equal(usageHeadline(value, NOW).text, '5% remaining')
})

test('passed resets and old partial windows never appear freshly replenished', () => {
  const value = usage()
  value.windows[0].resetsAt = NOW - 1
  assert.match(usageHeadline(value, NOW).text, /% stale$/)
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

test('startup includes every provider without any chat runtimes', () => {
  const entries = providerUsageEntries([], [])
  assert.deepEqual(entries.map((entry) => entry.provider), ['codex', 'claude', 'antigravity', 'cursor'])
  assert.ok(entries.every((entry) => entry.source === null))
  const loaded = providerUsageEntries([], [{ provider: 'antigravity', account: null, usage: usage(2) }])
  assert.equal(usageHeadline(loaded.find((entry) => entry.provider === 'antigravity')!.usage, NOW).remaining, 98)
})

test('account probes and chat push readings choose newest without duplicating accounts', () => {
  const chat = row('live', usage(40))
  const entries = providerUsageEntries([chat], [{ provider: 'codex', account: chat.providerUsage!.account, usage: usage(20, NOW - 1) }])
  assert.equal(entries.filter((entry) => entry.provider === 'codex').length, 1)
  assert.equal(entries[0].usage?.windows[0].percent, 40)
})

const HOUR = 3_600_000
const DAY = 24 * HOUR

test('window length comes from the label, and a month from its own reset', () => {
  assert.equal(usageWindowDuration({ label: '5-hour', percent: 0, resetsAt: null }), 5 * HOUR)
  assert.equal(usageWindowDuration({ label: 'Weekly (Opus)', percent: 0, resetsAt: null }), 7 * DAY)
  assert.equal(usageWindowDuration({ label: 'Daily', percent: 0, resetsAt: null }), DAY)
  assert.equal(usageWindowDuration({ label: '3-day', percent: 0, resetsAt: null }), 3 * DAY)
  const reset = new Date(2026, 9, 15).getTime()
  assert.equal(usageWindowDuration({ label: 'Monthly included', percent: 0, resetsAt: reset }), reset - new Date(2026, 8, 15).getTime())
  assert.equal(usageWindowDuration({ label: 'Monthly included', percent: 0, resetsAt: null }), null)
  assert.equal(usageWindowDuration({ label: 'Gemini Pro', percent: 0, resetsAt: NOW }), null)
})

test('pace warns only when the average rate empties the window before its reset', () => {
  const window = (percent: number, hoursLeft: number) => ({ label: '5-hour', percent, resetsAt: NOW + hoursLeft * HOUR })
  const pace = (percent: number, hoursLeft: number) => usagePace(window(percent, hoursLeft), usage(), NOW)
  // 60% gone in the first two hours: the rest lasts 80 more minutes, 100 short of the reset.
  const hot = pace(60, 3)
  assert.equal(hot?.runsOutAt, NOW + 80 * 60_000)
  assert.equal(hot?.shortBy, 100 * 60_000)
  assert.equal(pace(40, 3), null, 'exactly on pace is not a warning')
  assert.equal(pace(20, 1), null, 'under pace')
  assert.equal(pace(9, 4.4), null, 'too little of the allowance spent to call it a rate')
  assert.equal(pace(30, 4.8), null, 'too little of the window elapsed to call it a rate')
  assert.equal(pace(100, 3), null, 'an empty window has no pace')
  assert.equal(usagePace({ label: '5-hour', percent: 60, resetsAt: null }, usage(), NOW), null)
  assert.equal(usagePace({ label: 'Gemini Pro', percent: 60, resetsAt: NOW + HOUR }, usage(), NOW), null)
  assert.equal(usagePace(window(60, 3), usage(60, NOW - USAGE_STALE_MS - 1), NOW), null, 'a stale reading projects nothing')
})

test('the tightest window is the lowest remaining across every plan', () => {
  const weekly: ChatPlanUsage = { plan: 'Max', note: null, unavailable: null, updatedAt: NOW, windows: [
    { label: '5-hour', percent: 10, resetsAt: NOW + HOUR }, { label: 'Weekly', percent: 83, resetsAt: NOW + 5 * DAY + 8 * HOUR }
  ] }
  const entries = providerUsageEntries([], [
    { provider: 'codex', account: null, usage: usage(38) },
    { provider: 'claude', account: null, usage: weekly },
    { provider: 'cursor', account: null, usage: { ...usage(), windows: [], unavailable: 'Signed out' } }
  ])
  const tightest = tightestUsage(entries, NOW)
  assert.equal(tightest?.entry.provider, 'claude')
  assert.equal(tightest?.window.label, 'Weekly')
  assert.equal(tightest?.remaining, 17)
  assert.equal(tightest?.level, 'low')
  assert.equal(usageVerdict(tightest, 'Claude Code', NOW), 'Claude Code Weekly is down to 17% left and resets in 5d 8h.')
  assert.equal(tightestUsage(providerUsageEntries([], []), NOW), null)
  assert.equal(usageVerdict(null, '', NOW), 'No plan has reported a quota yet.')
  const roomy = tightestUsage(providerUsageEntries([], [{ provider: 'codex', account: null, usage: usage(38) }]), NOW)
  assert.equal(usageVerdict(roomy, 'Codex', NOW), 'Every plan has room. The tightest is Codex 5-hour at 62% left.')
  const empty = tightestUsage(providerUsageEntries([], [{ provider: 'codex', account: null, usage: usage(100) }]), NOW)
  assert.equal(usageVerdict(empty, 'Codex', NOW), 'Codex 5-hour is used up and resets in 1h.')
})

test('spans keep two units', () => {
  assert.equal(spanNote(20_000), 'under a minute')
  assert.equal(spanNote(45 * 60_000), '45m')
  assert.equal(spanNote(2 * HOUR + 14 * 60_000), '2h 14m')
  assert.equal(spanNote(3 * HOUR), '3h')
  assert.equal(spanNote(5 * DAY + 8 * HOUR + 20 * 60_000), '5d 8h')
  assert.equal(roughSpan(4 * DAY + 23 * HOUR), '5d')
  assert.equal(roughSpan(100 * 60_000), '2h')
  assert.equal(roughSpan(40 * 60_000), '40m')
})
