import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { runTaskCatalogModel, runTaskCatalogReplay } from './run-catalog.js'

const projectRoot = resolve(import.meta.dirname, '../../..')

test('model-golden path matches replay totals on the full catalog', async () => {
  const replay = await runTaskCatalogReplay({ projectRoot, concurrency: 8 })
  const model = await runTaskCatalogModel({ projectRoot, concurrency: 8, adapter: 'golden' })
  assert.equal(model.mode, 'model-golden')
  assert.equal(model.totals.runs, replay.totals.runs)
  assert.equal(model.totals.passed, replay.totals.passed)
})
