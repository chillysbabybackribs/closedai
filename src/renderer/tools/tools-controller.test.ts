import assert from 'node:assert/strict'
import test from 'node:test'

import type { ToolTelemetrySnapshot } from '../../shared/tools.ts'
import { applyRecord } from './tools-controller.ts'

test('live telemetry counts timeouts separately from genuine failures', () => {
  const initial: ToolTelemetrySnapshot = { stats: [], totalCalls: 0 }
  const timedOut = applyRecord(initial, {
    toolId: 'closedai_app.page', action: 'wait_for', ok: false, timedOut: true
  })
  const failed = applyRecord(timedOut, {
    toolId: 'closedai_app.page', action: 'wait_for', ok: false, timedOut: false
  })

  assert.deepEqual(failed.stats.find((stat) => stat.action === 'wait_for'), {
    toolId: 'closedai_app.page', action: 'wait_for', calls: 2, failures: 1, timeouts: 1
  })
  assert.equal(failed.totalCalls, 2)
})
