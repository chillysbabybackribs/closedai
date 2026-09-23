import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from './registry.js'
import { failureResult, textResult, type JsonObject, type ToolNamespace, type ToolResult } from './tool.js'

const BIG = 'x'.repeat(2000)

function registryOver(run: (input: JsonObject) => Promise<ToolResult>): ToolRegistry {
  const namespace: ToolNamespace = {
    name: 'alpha',
    description: 'Alpha tools',
    tools: [{
      name: 'read',
      description: 'read tool',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, mode: { type: 'string' } } },
      run
    }]
  }
  return new ToolRegistry([namespace])
}

const inThread = { paneId: 'pane-1', threadId: 't1', turnId: 'turn-1', callId: 'c' }
const text = (result: ToolResult): string => result.content.map((item) => item.type === 'text' ? item.text : '[image]').join('')

test('an identical repeat in the same thread comes back as a pointer, and the next one in full', async () => {
  let calls = 0
  const registry = registryOver(async () => { calls += 1; return textResult(BIG) })
  const call = () => registry.call({ namespace: 'alpha', tool: 'read', arguments: { path: 'a' } }, inThread)

  assert.equal(text(await call()), BIG)
  const repeat = await call()
  assert.match(text(repeat), /alpha\.read ran again with the same arguments/)
  assert.match(text(repeat), /2000 chars, unchanged/)
  assert.equal(repeat.isError, undefined)
  // The tool still ran: the collapse is of identical content, never of a stale answer.
  assert.equal(calls, 2)
  // A model that asks anyway is given the content back rather than left without it.
  assert.equal(text(await call()), BIG)
  assert.match(text(await call()), /ran again with the same arguments/)
})

test('changed content, a different thread, or different arguments are always delivered in full', async () => {
  let body = BIG
  const registry = registryOver(async (input) => textResult(`${String(input.path)}:${body}`))
  const call = (args: JsonObject, context = inThread) => registry.call({ namespace: 'alpha', tool: 'read', arguments: args }, context)

  await call({ path: 'a', mode: 'raw' })
  // Key order must not decide identity.
  assert.match(text(await call({ mode: 'raw', path: 'a' })), /ran again/)
  await call({ path: 'a', mode: 'raw' })
  body = 'moved'
  assert.equal(text(await call({ path: 'a', mode: 'raw' })), 'a:moved')

  body = BIG
  await call({ path: 'b' })
  assert.equal(text(await call({ path: 'c' })), `c:${BIG}`)
  // Another thread has not seen it, so it is content there even though the bytes match.
  const elsewhere = { ...inThread, threadId: 't2', paneId: 'pane-2' }
  assert.equal(text(await call({ path: 'b' }, elsewhere)), `b:${BIG}`)
})

test('small results, failures, and context-less callers are left alone', async () => {
  const small = registryOver(async () => textResult('short'))
  await small.call({ namespace: 'alpha', tool: 'read', arguments: {} }, inThread)
  assert.equal(text(await small.call({ namespace: 'alpha', tool: 'read', arguments: {} }, inThread)), 'short')

  const failing = registryOver(async () => failureResult(BIG))
  await failing.call({ namespace: 'alpha', tool: 'read', arguments: {} }, inThread)
  assert.equal(text(await failing.call({ namespace: 'alpha', tool: 'read', arguments: {} }, inThread)), BIG)

  const system = registryOver(async () => textResult(BIG))
  const loose = { threadId: null, turnId: null, callId: 'c' }
  await system.call({ namespace: 'alpha', tool: 'read', arguments: {} }, loose)
  assert.equal(text(await system.call({ namespace: 'alpha', tool: 'read', arguments: {} }, loose)), BIG)
})

test('an identical image is collapsed however small its text is', async () => {
  const registry = registryOver(async () => ({
    content: [{ type: 'image' as const, dataUrl: 'data:image/png;base64,AAAA' }, { type: 'text' as const, text: 'tab 1' }]
  }))
  const call = () => registry.call({ namespace: 'alpha', tool: 'read', arguments: {} }, inThread)
  assert.match(text(await call()), /\[image\]tab 1/)
  const repeat = await call()
  assert.equal(repeat.content.length, 1)
  assert.match(text(repeat), /the same image and 5 chars, unchanged/)
})
