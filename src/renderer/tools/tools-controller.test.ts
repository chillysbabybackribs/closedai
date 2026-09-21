import assert from 'node:assert/strict'
import test from 'node:test'

import type { ToolTelemetrySnapshot } from '../../shared/tools.ts'
import { applyRecord } from './tools-controller.ts'

test('live telemetry counts timeouts separately from genuine failures and keeps error notes', () => {
  const initial: ToolTelemetrySnapshot = { stats: [], totalCalls: 0, since: 1, errors: [] }
  const timedOut = applyRecord(initial, {
    toolId: 'closedai_app.ui', action: 'wait_for', ok: false, timedOut: true, misuse: false, at: 10, message: 'condition not reached'
  })
  const failed = applyRecord(timedOut, {
    toolId: 'closedai_app.ui', action: 'wait_for', ok: false, timedOut: false, misuse: false, at: 20, message: 'target closed'
  })

  assert.deepEqual(failed.stats.find((stat) => stat.action === 'wait_for'), {
    toolId: 'closedai_app.ui', action: 'wait_for', calls: 2, failures: 1, timeouts: 1, misuses: 0, lastCalledAt: 20, lastFailedAt: 20
  })
  assert.equal(failed.totalCalls, 2)
  assert.deepEqual(failed.errors.map((note) => [note.kind, note.message]), [['error', 'target closed'], ['timeout', 'condition not reached']])
})
