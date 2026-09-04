import assert from 'node:assert/strict'
import test from 'node:test'
import { RequestBudget } from './request-budget.js'

test('admission is shared, origin bounded, fair between owners, and cancellable while queued', async () => {
  const budget = new RequestBudget(2, 1)
  const signal = new AbortController().signal
  const started: string[] = []
  const finish = new Map<string, () => void>()
  const task = (key: string, owner: string, id: string, abortSignal = signal) => budget.run(key, owner, abortSignal, async () => {
    started.push(id)
    await new Promise<void>((resolve) => finish.set(id, resolve))
  })
  const first = task('origin-a', 'pane-a', 'first')
  const queued = task('origin-a', 'pane-a', 'queued')
  const other = task('origin-b', 'pane-b', 'other')
  const controller = new AbortController()
  const cancelled = task('origin-c', 'pane-c', 'cancelled', controller.signal)
  controller.abort(new Error('cancelled'))
  await assert.rejects(cancelled, /cancelled/)
  assert.deepEqual(started, ['first', 'other'])
  finish.get('first')!()
  await first
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(started, ['first', 'other', 'queued'])
  finish.get('other')!(); finish.get('queued')!()
  await Promise.all([other, queued])
  await budget.run('origin-a', 'pane-a', signal, async () => {})
})
