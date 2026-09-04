import assert from 'node:assert/strict'
import test from 'node:test'
import { cancelPaneWarm, PANE_WARM_DWELL_MS, schedulePaneWarm } from './provider-warm.ts'

test('schedulePaneWarm waits for dwell before warming', async () => {
  const calls: string[] = []
  schedulePaneWarm('pane-a', async (id) => { calls.push(id) }, 20)
  assert.deepEqual(calls, [])
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.deepEqual(calls, ['pane-a'])
})

test('cancelPaneWarm clears a pending warm', async () => {
  const calls: string[] = []
  schedulePaneWarm('pane-a', async (id) => { calls.push(id) }, 20)
  cancelPaneWarm()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.deepEqual(calls, [])
})

test('the default dwell matches the appv1 gate', () => {
  assert.equal(PANE_WARM_DWELL_MS, 400)
})
