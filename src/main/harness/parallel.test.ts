import assert from 'node:assert/strict'
import test from 'node:test'
import { mapParallel } from './parallel.js'

test('mapParallel preserves order under concurrency', async () => {
  const items = [40, 10, 30, 20]
  const out = await mapParallel(items, 2, async (ms) => {
    await new Promise((r) => setTimeout(r, ms))
    return ms
  })
  assert.deepEqual(out, items)
})
