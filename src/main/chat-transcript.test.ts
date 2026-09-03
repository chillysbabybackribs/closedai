import assert from 'node:assert/strict'
import test from 'node:test'

import type { ChatEvent, ChatTranscriptItem } from '../shared/chat.ts'
import { ChatTranscript } from './chat-transcript.ts'

function transcript(clock: { now: number }): { transcript: ChatTranscript; events: ChatEvent[] } {
  const events: ChatEvent[] = []
  return {
    transcript: new ChatTranscript('/repo', () => 'turn-1', (event) => events.push(event), () => null, () => clock.now),
    events
  }
}

const running: ChatTranscriptItem = {
  type: 'command', id: 'c1', turnId: 'turn-1', command: 'npm test', cwd: '/repo', status: 'inProgress', output: '', exitCode: null
}

test('an activity is stamped when first seen running and again when it settles', () => {
  const clock = { now: 1_000 }
  const { transcript: t, events } = transcript(clock)
  t.upsert(running)
  clock.now = 3_500
  t.upsert({ ...running, status: 'completed', exitCode: 0, output: 'ok' })
  const items = events.flatMap((event) => (event.type === 'item' ? [event.item] : []))
  assert.equal(items.length, 2)
  assert.deepEqual([items[0]?.startedAt, items[0]?.finishedAt], [1_000, undefined])
  assert.deepEqual([items[1]?.startedAt, items[1]?.finishedAt], [1_000, 3_500])
  assert.equal(t.snapshot()[0]?.finishedAt, 3_500)
})

test('a settled item never seen running carries no timing', () => {
  const clock = { now: 1_000 }
  const { transcript: t } = transcript(clock)
  t.upsert({ ...running, status: 'completed', exitCode: 0 })
  const item = t.snapshot()[0]
  assert.equal(item?.type, 'command')
  assert.equal('startedAt' in (item ?? {}), false)
})

test('provider-supplied timing wins over the app clock and survives later updates', () => {
  const clock = { now: 9_000 }
  const { transcript: t } = transcript(clock)
  t.upsert({ type: 'tool', id: 't1', turnId: 'turn-1', label: 'Web search', detail: 'q', status: 'inProgress', startedAt: 500 })
  t.upsert({ type: 'tool', id: 't1', turnId: 'turn-1', label: 'Web search', detail: 'q', status: 'completed' })
  assert.deepEqual(
    t.snapshot().map((item) => [item.type === 'tool' ? item.startedAt : null, item.type === 'tool' ? item.finishedAt : null]),
    [[500, 9_000]]
  )
})

test('streamed output placeholders start their clock immediately', () => {
  const clock = { now: 42 }
  const { transcript: t } = transcript(clock)
  t.appendDelta('c9', 'output', 'hello')
  const item = t.snapshot()[0]
  assert.equal(item?.type === 'command' && item.startedAt, 42)
})

test('non-activity items pass through untouched', () => {
  const clock = { now: 42 }
  const { transcript: t } = transcript(clock)
  t.addNotice('hi', 'info')
  assert.equal('startedAt' in (t.snapshot()[0] ?? {}), false)
})
