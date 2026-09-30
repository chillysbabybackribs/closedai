import assert from 'node:assert/strict'
import test from 'node:test'
import { cursorPlanUsage } from './cursor-usage.js'

const plan = { planInfo: { planName: 'Pro', billingCycleEnd: '1792638934000' } }

test('CLI percentages override misleading spend ratios and retain each monthly scope', () => {
  const usage = cursorPlanUsage({ billingCycleEnd: '1792638934000', planUsage: {
    includedSpend: 2000, limit: 2000, totalPercentUsed: 84.925, autoPercentUsed: 83.366, apiPercentUsed: 100
  }, spendLimitUsage: { limitType: 'user' } }, plan, { noUsageBasedAllowed: true }, 123)
  assert.deepEqual(usage, { plan: 'Pro', windows: [
    { label: 'Monthly included', percent: 85, resetsAt: 1792638934000 },
    { label: 'Monthly Auto', percent: 83, resetsAt: 1792638934000 },
    { label: 'Monthly API', percent: 100, resetsAt: 1792638934000 }
  ], note: 'On-demand usage off', unavailable: null, updatedAt: 123 })
})

test('older responses use a valid included spend ratio without inventing scoped allowances', () => {
  const usage = cursorPlanUsage({ planUsage: { includedSpend: 50, limit: 200 } }, plan, null)
  assert.deepEqual(usage.windows, [{ label: 'Monthly included', percent: 25, resetsAt: 1792638934000 }])
  assert.equal(usage.note, null)
})

test('missing, nonfinite and malformed percentages cannot imply unused allowance', () => {
  for (const planUsage of [undefined, {}, { totalPercentUsed: NaN, autoPercentUsed: Infinity, apiPercentUsed: '50' },
    { includedSpend: 2, limit: 0 }, { includedSpend: -1, limit: 20 }]) {
    const usage = cursorPlanUsage({ planUsage }, null, null)
    assert.equal(usage.windows.length, 0)
    assert.ok(usage.unavailable)
  }
  const usage = cursorPlanUsage({ billingCycleEnd: 'nonsense', planUsage: { totalPercentUsed: 0, apiPercentUsed: 120 } }, null, null)
  assert.deepEqual(usage.windows.map(({ percent, resetsAt }) => [percent, resetsAt]), [[0, null], [100, null]])
})

test('paid on-demand limits remain notes and preserve the CLI cents/dollars distinction', () => {
  const current = { planUsage: { totalPercentUsed: 20 }, spendLimitUsage: { individualUsed: 1234 } }
  assert.equal(cursorPlanUsage(current, plan, { hardLimit: 50 }).note, 'On-demand: $12.34 of $50.00')
  assert.equal(cursorPlanUsage(current, plan, { hardLimit: 2147483647 }).note, 'On-demand: $12.34 · no monthly limit')
  assert.equal(cursorPlanUsage({ ...current, spendLimitUsage: { individualUsed: 1234, individualLimit: 5000, limitType: 'team' } }, plan, null).note,
    'On-demand: $12.34 of $50.00')
  assert.equal(cursorPlanUsage(current, plan, { hardLimit: 0 }).windows.length, 1)
})

test('team personal limits take precedence while personal accounts use their hard limit', () => {
  const spendLimitUsage = { individualUsed: 100, individualLimit: 5000 }
  assert.equal(cursorPlanUsage({ spendLimitUsage }, null, { hardLimit: 20 }).note, 'On-demand: $1.00 of $20.00')
  assert.equal(cursorPlanUsage({ spendLimitUsage: { ...spendLimitUsage, limitType: 'team' } }, null,
    { noUsageBasedAllowed: true }).note, 'On-demand: $1.00 of $50.00')
})
