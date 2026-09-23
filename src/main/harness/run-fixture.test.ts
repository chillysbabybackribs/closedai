import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { runTaskCatalogReplay } from './run-catalog.js'

const projectRoot = resolve(import.meta.dirname, '../../..')

test('pilot catalog replay passes under parallel stub hosts', async () => {
  const report = await runTaskCatalogReplay({ projectRoot, concurrency: 8 })
  assert.ok(report.totals.runs >= 8, 'expected base tasks plus variation expansion')
  assert.equal(report.totals.failed, 0, report.results.filter((r) => !r.passed).map((r) => r.failures).join('\n'))
})
