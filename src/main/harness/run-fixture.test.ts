import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { runTaskCatalogReplay } from './run-catalog.js'

const catalog = resolve(import.meta.dirname, '../../../harness/tasks/embedded_browser.page.json')

test('pilot catalog replay passes under parallel stub hosts', async () => {
  const report = await runTaskCatalogReplay({ catalogPath: catalog, concurrency: 8 })
  assert.ok(report.totals.runs >= 8, 'expected base tasks plus variation expansion')
  assert.equal(report.totals.failed, 0, report.results.filter((r) => !r.passed).map((r) => r.failures).join('\n'))
})
