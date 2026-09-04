import assert from 'node:assert/strict'
import test from 'node:test'
import {
  antigravityPlanUsage,
  applyPlanUsageSignal,
  claudePlanUsage,
  claudeRateLimitSignal,
  codexPlanUsage,
  planUsageUnavailable,
  planWindowLabel
} from './plan-usage.ts'

const NOW = 1_788_500_000_000

test('window labels read the way each provider names its buckets', () => {
  assert.equal(planWindowLabel(300), '5-hour')
  assert.equal(planWindowLabel(10_080), 'Weekly')
  assert.equal(planWindowLabel(1_440), 'Daily')
  assert.equal(planWindowLabel(4_320), '3-day')
  assert.equal(planWindowLabel(0), 'Usage')
})

// Shape captured live from `account/rateLimits/read` on codex-cli 0.153.0 (2026-09-03).
test('codex rate limits become windows with millisecond resets', () => {
  const usage = codexPlanUsage({
    limitId: 'codex',
    primary: { usedPercent: 11.4, windowDurationMins: 300, resetsAt: 1_788_484_492 },
    secondary: { usedPercent: 96, windowDurationMins: 10_080, resetsAt: 1_788_902_504 },
    credits: { hasCredits: true, unlimited: false, balance: '25' },
    planType: 'prolite'
  }, NOW)
  assert.ok(usage)
  assert.equal(usage.plan, 'Pro Lite')
  assert.deepEqual(usage.windows, [
    { label: '5-hour', percent: 11, resetsAt: 1_788_484_492_000 },
    { label: 'Weekly', percent: 96, resetsAt: 1_788_902_504_000 }
  ])
  assert.equal(usage.note, '25 credits')
  assert.equal(usage.updatedAt, NOW)
})

test('a codex account with one window and no credits reports just that window', () => {
  const usage = codexPlanUsage({
    primary: { usedPercent: 60, windowDurationMins: 10_080, resetsAt: 1_788_748_158 },
    secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: '0' },
    planType: 'pro'
  }, NOW)
  assert.deepEqual(usage?.windows.map((window) => window.label), ['Weekly'])
  assert.equal(usage?.note, null)
})

test('claude usage windows keep their order and parse ISO resets', () => {
  const usage = claudePlanUsage({
    subscription_type: 'max',
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 42.6, resets_at: '2026-09-03T21:00:00.000Z' },
      seven_day: { utilization: 12, resets_at: null },
      seven_day_opus: { utilization: null, resets_at: null },
      model_scoped: [{ display_name: 'Fable', utilization: 4, resets_at: null }]
    }
  }, NOW)
  assert.equal(usage?.plan, 'Max')
  assert.deepEqual(usage?.windows, [
    { label: '5-hour', percent: 43, resetsAt: Date.parse('2026-09-03T21:00:00.000Z') },
    { label: 'Weekly', percent: 12, resetsAt: null },
    { label: 'Weekly (Fable)', percent: 4, resetsAt: null }
  ])
})

test('an API-key claude session says plan limits do not apply', () => {
  const usage = claudePlanUsage({ subscription_type: null, rate_limits_available: false, rate_limits: null }, NOW)
  assert.deepEqual(usage?.windows, [])
  assert.match(usage?.unavailable ?? '', /do not apply/)
})

test('a mid-turn rate limit event updates only the window it names', () => {
  const before = codexPlanUsage({
    primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 0 },
    secondary: { usedPercent: 20, windowDurationMins: 10_080, resetsAt: 0 },
    planType: 'pro'
  }, NOW)
  const signal = claudeRateLimitSignal({ status: 'allowed', rateLimitType: 'five_hour', utilization: 55, resetsAt: 1_788_484_492 })
  assert.deepEqual(signal, { label: '5-hour', percent: 55, resetsAt: 1_788_484_492_000 })
  const after = applyPlanUsageSignal(before, signal!, NOW + 1_000)
  assert.deepEqual(after.windows, [
    { label: '5-hour', percent: 55, resetsAt: 1_788_484_492_000 },
    { label: 'Weekly', percent: 20, resetsAt: null }
  ])
  assert.equal(after.plan, 'Pro')
  assert.equal(after.updatedAt, NOW + 1_000)
})

test('an event for an unnamed window is ignored rather than mislabelled', () => {
  assert.equal(claudeRateLimitSignal({ status: 'allowed', utilization: 55 }), null)
  assert.equal(claudeRateLimitSignal({ status: 'allowed', rateLimitType: 'overage', utilization: 55 }), null)
})

test('a provider with nothing to report says so', () => {
  const usage = planUsageUnavailable('no usage here', NOW)
  assert.deepEqual(usage, { plan: null, windows: [], note: null, unavailable: 'no usage here', updatedAt: NOW })
})

test('antigravity quota response parses groups and remaining fractions into windows', () => {
  const usage = antigravityPlanUsage({
    status: 'SUCCESS',
    command: {
      name: 'usage',
      data: {
        groups: [
          {
            name: 'Gemini Models',
            buckets: [
              { window: 'weekly', remaining_fraction: 0.96, reset_time: '2026-09-10T18:35:39Z' },
              { window: '5h', remaining_fraction: 0.92, reset_time: '2026-09-04T04:35:39Z' }
            ]
          },
          {
            name: 'Claude and GPT models',
            buckets: [
              { window: 'weekly', remaining_fraction: 0.98, reset_time: '2026-09-06T19:24:23Z' },
              { window: '5h', remaining_fraction: 0.98, reset_time: '2026-09-04T03:58:39Z' }
            ]
          }
        ]
      }
    }
  }, NOW)
  assert.ok(usage)
  assert.equal(usage.plan, null)
  assert.deepEqual(usage.windows, [
    { label: '5-hour (Gemini)', percent: 8, resetsAt: Date.parse('2026-09-04T04:35:39Z') },
    { label: 'Weekly (Gemini)', percent: 4, resetsAt: Date.parse('2026-09-10T18:35:39Z') },
    { label: '5-hour (Claude & GPT)', percent: 2, resetsAt: Date.parse('2026-09-04T03:58:39Z') },
    { label: 'Weekly (Claude & GPT)', percent: 2, resetsAt: Date.parse('2026-09-06T19:24:23Z') }
  ])
  assert.equal(usage.updatedAt, NOW)
})

test('antigravity quota parses fallback tab-separated response lines', () => {
  const usage = antigravityPlanUsage({
    response: 'Gemini Models\tFive Hour Limit Remaining\t90%\t2026-09-04T04:35:39Z\nGemini Models\tWeekly Limit Remaining\t95%\t2026-09-10T18:35:39Z\n'
  }, NOW)
  assert.ok(usage)
  assert.deepEqual(usage.windows, [
    { label: '5-hour (Gemini)', percent: 10, resetsAt: Date.parse('2026-09-04T04:35:39Z') },
    { label: 'Weekly (Gemini)', percent: 5, resetsAt: Date.parse('2026-09-10T18:35:39Z') }
  ])
})

