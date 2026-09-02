import assert from 'node:assert/strict'
import test from 'node:test'
import { allSettledBounded } from './bounded-concurrency.ts'

test('runs bounded work in parallel and preserves result order', async () => {
  let active = 0
  let peak = 0
  const results = await allSettledBounded([40, 10, 20, 5], 2, async (delay) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, delay))
    active -= 1
    return delay * 2
  })

  assert.equal(peak, 2)
  assert.deepEqual(results, [
    { status: 'fulfilled', value: 80 },
    { status: 'fulfilled', value: 20 },
    { status: 'fulfilled', value: 40 },
    { status: 'fulfilled', value: 10 }
  ])
})

test('keeps failures isolated so other work completes', async () => {
  const results = await allSettledBounded([0, 1, 2], 3, async (value) => {
    if (value === 1) throw new Error('expected')
    return value
  })

  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.equal(results[2].status, 'fulfilled')
})
