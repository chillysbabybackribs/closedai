import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatEvent } from '../../shared/chat.js'
import { ResponsePaintTracker } from './response-paint.js'

test('counts the first live visible text once, ignoring replay, whitespace, and hidden panes', () => {
  let now = 0
  let visible = true
  const tracker = new ResponsePaintTracker(() => now)
  const observe = (event: ChatEvent) => tracker.observe({ type: 'pane', paneId: 'p', event }, () => visible)
  const item = (text: string, turnId = 't'): ChatEvent => ({ type: 'item', item: {
    type: 'assistant', id: 'a', turnId, text, phase: null, streaming: true
  } })
  observe(item('Replay'))
  observe({ type: 'turn', turnId: 't' })
  observe(item('Wrong turn', 'old'))
  observe(item(' '))
  now = 10
  observe({ type: 'itemDelta', itemId: 'a', field: 'text', delta: 'Hello' })
  now = 20
  observe(item('Hello again'))
  now = 40
  assert.equal(tracker.take('p', 't'), 30)
  assert.equal(tracker.take('p', 't'), null)
  observe({ type: 'turn', turnId: null })
  observe(item('Late update'))
  observe({ type: 'turn', turnId: 'next' })
  visible = false
  observe(item('Hidden', 'next'))
  visible = true
  observe(item('Visible later', 'next'))
  assert.equal(tracker.take('p', 'next'), null)
})
