import assert from 'node:assert/strict'
import test from 'node:test'
import { TitleQueue } from './title-queue.js'

test('serializes across callers, skips aborted waiting jobs, and releases failed work', async () => {
  const queue = new TitleQueue()
  const calls: string[] = []
  let finish!: (value: string) => void
  const first = queue.run(() => { calls.push('first'); return new Promise<string>((resolve) => { finish = resolve }) }, new AbortController().signal)
  const cancelled = new AbortController()
  const second = queue.run(async () => { calls.push('cancelled'); return 'bad' }, cancelled.signal)
  const third = queue.run(async () => { calls.push('third'); throw new Error('offline') }, new AbortController().signal)
  const rejection = assert.rejects(third, /offline/)
  const fourth = queue.run(async () => { calls.push('fourth'); return 'done' }, new AbortController().signal)
  cancelled.abort()
  assert.equal(await second, null)
  assert.deepEqual(calls, ['first'])
  finish('first title')
  assert.equal(await first, 'first title')
  await rejection
  assert.equal(await fourth, 'done')
  assert.deepEqual(calls, ['first', 'third', 'fourth'])
})
