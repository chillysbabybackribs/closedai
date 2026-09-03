import assert from 'node:assert/strict'
import test from 'node:test'

import type { ChatEvent, ChatTranscriptItem } from '../shared/chat.ts'
import { ChatTranscript } from './chat-transcript.ts'

function timing(item: ChatTranscriptItem | undefined): [number | undefined, number | undefined] {
  if (!item || (item.type !== 'command' && item.type !== 'fileChange' && item.type !== 'tool')) return [undefined, undefined]
  return [item.startedAt, item.finishedAt]
}

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
  assert.deepEqual(timing(items[0]), [1_000, undefined])
  assert.deepEqual(timing(items[1]), [1_000, 3_500])
  assert.deepEqual(timing(t.snapshot()[0]), [1_000, 3_500])
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
  assert.deepEqual(t.snapshot().map(timing), [[500, 9_000]])
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

test('assistant timestamps survive completion without inventing dates for replayed answers', () => {
  const clock = { now: 1234 }
  const { transcript: store } = transcript(clock)
  store.upsert({ type: 'assistant', id: 'answer', turnId: 'turn-1', text: 'Hello', phase: null, streaming: true })
  clock.now = 5678
  store.upsert({ type: 'assistant', id: 'answer', turnId: 'turn-1', text: 'Hello world', phase: 'final_answer', streaming: false })
  const answer = store.snapshot()[0]
  assert.equal(answer?.type === 'assistant' && answer.createdAt, 1234)
  store.upsert({ type: 'assistant', id: 'old', turnId: 'old-turn', text: 'History', phase: 'final_answer', streaming: false })
  const old = store.snapshot()[1]
  assert.equal(old?.type === 'assistant' && old.createdAt, undefined)
})

test('history pages use stable exclusive cursors and return detached items', () => {
  const { transcript: store } = transcript({ now: 1 })
  store.replaceItems(Array.from({ length: 10_000 }, (_, i) => ({ type: 'user', id: `u${i}`, turnId: null, text: `message ${i}` })))
  const tail = store.page({ limit: 200 })
  assert.equal(tail.items.length, 200)
  assert.equal(tail.items[0]!.id, 'u9800')
  assert.equal(tail.hasEarlier, true)
  store.upsert({ type: 'user', id: 'new', turnId: null, text: 'appended during paging' })
  const earlier = store.page({ beforeItemId: 'u9800', limit: 200 })
  assert.equal(earlier.items.at(-1)!.id, 'u9799')
  earlier.items[0]!.id = 'changed copy'
  assert.equal(store.page({ beforeItemId: 'u9800', limit: 200 }).items[0]!.id, 'u9600')
  assert.equal(store.page({ beforeItemId: 'u100', limit: 200 }).hasEarlier, false)
  assert.deepEqual(store.page({ limit: 0 }).items, [])
  assert.throws(() => store.page({ beforeItemId: 'gone', limit: 200 }), /History changed/)
})

test('history replay is silent and live upserts distinguish appends from updates', () => {
  const { transcript: store, events } = transcript({ now: 1 })
  store.replaceFromThread({ turns: [{ id: 't', items: [
    { type: 'agentMessage', id: 'answer', text: 'old answer' }
  ] }] })
  assert.equal(store.snapshot().length, 1)
  assert.equal(events.length, 0)
  store.upsert({ type: 'assistant', id: 'answer', turnId: 't', text: 'edited', phase: null, streaming: false })
  store.upsert({ type: 'user', id: 'new', turnId: null, text: 'next' })
  assert.deepEqual(events.map((event) => event.type === 'item' && event.appended), [false, true])
})

test('paged snapshots retain background status outside the visible window', () => {
  const { transcript: store } = transcript({ now: 1 })
  const task = { type: 'tool' as const, id: 'task', turnId: 'old', label: 'Agent', detail: 'working',
    status: 'running', background: { taskId: 'task', kind: 'agent' as const } }
  store.replaceItems([task, ...Array.from({ length: 500 }, (_, i) => ({ type: 'user' as const, id: `u${i}`, turnId: null, text: 'message' }))])
  assert.equal(store.page({ limit: 200 }).backgroundTasks?.[0]?.id, 'task')
  store.upsert({ ...task, status: 'completed' })
  assert.equal(store.page({ limit: 200 }).backgroundTasks, undefined)
  store.clear()
  assert.equal(store.page({ limit: 200 }).hasEarlier, false)
  assert.equal(store.page({ limit: 200 }).backgroundTasks, undefined)
})
