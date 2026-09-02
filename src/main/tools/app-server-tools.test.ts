import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppServerRequest } from '../app-server-client.js'
import { AppServerToolCalls, type CompletedToolCall } from './app-server-tools.js'
import { ToolRegistry } from './registry.js'

test('dynamic tool completion is observable without changing the image response', async () => {
  const calls: CompletedToolCall[] = []
  const responses: unknown[] = []
  const registry = new ToolRegistry([{
    name: 'closedai_ui',
    description: 'UI',
    tools: [{
      name: 'capture',
      description: 'Capture',
      inputSchema: { type: 'object', properties: {} },
      run: async () => ({ content: [
        { type: 'text', text: 'Surface: application window' },
        { type: 'image', dataUrl: 'data:image/png;base64,cG5n' }
      ] })
    }]
  }])
  const handler = new AppServerToolCalls(registry, {
    respond: (id, result) => { responses.push([id, result]) },
    respondWithError: (id, code, message) => { responses.push([id, code, message]) }
  }, (call) => calls.push(call))
  const request: AppServerRequest = {
    id: 7,
    method: 'item/tool/call',
    params: {
      namespace: 'closedai_ui', tool: 'capture', arguments: { action: 'app_window' },
      threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1'
    }
  }

  assert.equal(handler.handle(request), true)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].context, { threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1' })
  assert.deepEqual(responses, [[7, {
    success: true,
    contentItems: [
      { type: 'inputText', text: 'Surface: application window' },
      { type: 'inputImage', imageUrl: 'data:image/png;base64,cG5n' }
    ]
  }]])
})

test('a broken completion observer cannot prevent the model receiving its tool result', async () => {
  const responses: unknown[] = []
  const registry = new ToolRegistry([{
    name: 'test', description: 'Test', tools: [{
      name: 'ok', description: 'OK', inputSchema: { type: 'object', properties: {} },
      run: async () => ({ content: [{ type: 'text', text: 'done' }] })
    }]
  }])
  const handler = new AppServerToolCalls(registry, {
    respond: (_id, result) => { responses.push(result) },
    respondWithError: () => {}
  }, () => { throw new Error('observer failed') })

  handler.handle({ id: 8, method: 'item/tool/call', params: { namespace: 'test', tool: 'ok', arguments: {} } })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(responses, [{ success: true, contentItems: [{ type: 'inputText', text: 'done' }] }])
})
