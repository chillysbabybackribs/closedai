import assert from 'node:assert/strict'
import test from 'node:test'
import type { CompletedToolCall } from './tools/app-server-tools.js'
import { ScreenshotContextLifecycle } from './screenshot-context-lifecycle.js'

const captureCall = (overrides: Partial<CompletedToolCall> = {}): CompletedToolCall => ({
  request: { namespace: 'closedai_ui', tool: 'capture', arguments: { action: 'app_window' } },
  context: { threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1' },
  result: { content: [{ type: 'image', dataUrl: 'data:image/png;base64,cG5n' }] },
  ...overrides
})

const completed = (turnId = 'turn-1') => ({
  method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: turnId } }
})

test('a successful screenshot schedules one compaction after its turn', () => {
  const lifecycle = new ScreenshotContextLifecycle()
  lifecycle.observe(captureCall())
  lifecycle.observe(captureCall({ context: { threadId: 'thread-1', turnId: 'turn-1', callId: 'call-2' } }))
  assert.deepEqual(lifecycle.consumeCompleted(completed()), { threadId: 'thread-1', turnId: 'turn-1' })
  assert.equal(lifecycle.consumeCompleted(completed()), null)
})

test('ordinary tools and failed or imageless captures never compact context', () => {
  const lifecycle = new ScreenshotContextLifecycle()
  lifecycle.observe(captureCall({ request: { namespace: 'embedded_browser', tool: 'page', arguments: {} } }))
  lifecycle.observe(captureCall({ result: { content: [{ type: 'text', text: 'failed' }], isError: true } }))
  lifecycle.observe(captureCall({ result: { content: [{ type: 'text', text: 'no pixels' }] } }))
  assert.equal(lifecycle.consumeCompleted(completed()), null)
})

test('clearing the lifecycle forgets pending screenshot turns', () => {
  const lifecycle = new ScreenshotContextLifecycle()
  lifecycle.observe(captureCall())
  lifecycle.clear()
  assert.equal(lifecycle.consumeCompleted(completed()), null)
})
