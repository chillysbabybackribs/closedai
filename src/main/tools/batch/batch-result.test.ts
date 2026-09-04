import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from '../registry.js'
import { textResult, type ToolNamespace, type ToolResult } from '../tool.js'
import { batchTools } from './index.js'

const context = { threadId: 't', turnId: 'u', callId: 'c' }

function harness(): ToolRegistry {
  const lab: ToolNamespace = {
    name: 'lab',
    description: 'Result fixtures',
    tools: [
      {
        name: 'echo',
        description: 'Echoes its text argument.',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        run: async (input) => textResult(String(input.text))
      },
      {
        name: 'boom',
        description: 'Always fails.',
        inputSchema: { type: 'object', properties: {} },
        run: async () => ({ content: [{ type: 'text' as const, text: 'it broke' }], isError: true })
      },
      {
        name: 'snap',
        description: 'Returns a caption and an image.',
        inputSchema: { type: 'object', properties: {} },
        run: async () => ({ content: [
          { type: 'text' as const, text: 'a picture' },
          { type: 'image' as const, dataUrl: 'data:image/png;base64,AA==' }
        ] })
      }
    ]
  }
  let registry: ToolRegistry
  registry = new ToolRegistry([lab, batchTools(() => registry)])
  return registry
}

function call(registry: ToolRegistry, calls: unknown[], parallel = false): Promise<ToolResult> {
  return registry.call({
    namespace: 'tool_batch', tool: 'run', arguments: { calls, parallel }
  }, context)
}

function batchText(result: ToolResult): string {
  return result.content.flatMap((item) => item.type === 'text' ? [item.text] : []).join('\n\n')
}

test('images from inner calls are re-attached after the combined text, in call order', async () => {
  const result = await call(harness(), [
    { tool: 'lab.snap' },
    { tool: 'lab.echo', arguments: { text: 'tail' } }
  ])
  assert.match(batchText(result), /\[1\] lab\.snap — ok\na picture\n\(1 image attached below, in call order\)/)
  assert.deepEqual(result.content.find((item) => item.type === 'image'), {
    type: 'image', dataUrl: 'data:image/png;base64,AA=='
  })
})

test('successful intermediate results can be suppressed without hiding failures', async () => {
  const result = await call(harness(), [
    { tool: 'lab.echo', arguments: { text: 'private intermediate' }, include_result: false },
    { tool: 'lab.snap', include_result: false },
    { tool: 'lab.boom', include_result: false }
  ], true)
  const text = batchText(result)
  assert.match(text, /\[1\] lab\.echo — ok/)
  assert.doesNotMatch(text, /private intermediate|a picture/)
  assert.match(text, /\[2\] lab\.snap — ok/)
  assert.match(text, /\[3\] lab\.boom — failed\nit broke/)
  assert.equal(result.content.some((item) => item.type === 'image'), false)
})

test('large successful results cannot hide a short failure in the middle of a batch', async () => {
  const large = 'x'.repeat(20_000)
  const sized: ToolNamespace = {
    name: 'sized',
    description: 'Sized results',
    tools: [{
      name: 'run',
      description: 'Returns requested content',
      inputSchema: { type: 'object', properties: { fail: { type: 'boolean' } } },
      run: async (input) => input.fail
        ? { content: [{ type: 'text', text: 'recover with tab-1' }], isError: true }
        : textResult(large)
    }]
  }
  let registry: ToolRegistry
  registry = new ToolRegistry([sized, batchTools(() => registry)])
  const result = await call(registry, [
    { tool: 'sized.run' },
    { tool: 'sized.run', arguments: { fail: true } },
    { tool: 'sized.run' }
  ], true)

  assert.match(batchText(result), /\[2\] sized\.run — failed\nrecover with tab-1/)
})
