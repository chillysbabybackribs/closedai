import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from '../registry.js'
import { textResult, type ToolNamespace, type ToolResult } from '../tool.js'
import { batchTools, MAX_BATCH_CALLS } from './index.js'

// Every test drives the batch through registry.call — the same path the Codex adapter
// uses — so its schema validation, switches, and telemetry are part of what is verified.

const context = { threadId: 't', turnId: 'u', callId: 'c' }

function harness(): { registry: ToolRegistry; log: string[] } {
  const log: string[] = []
  const lab: ToolNamespace = {
    name: 'lab',
    description: 'Test tools',
    tools: [
      {
        name: 'echo',
        description: 'Echoes its text argument.',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        run: async (input) => {
          log.push(`echo:${String(input.text)}`)
          return textResult(`echoed ${String(input.text)}`)
        }
      },
      {
        name: 'boom',
        description: 'Always fails.',
        inputSchema: { type: 'object', properties: {} },
        run: async () => {
          log.push('boom')
          return { content: [{ type: 'text', text: 'it broke' }], isError: true }
        }
      },
      {
        name: 'snap',
        description: 'Returns a caption and an image.',
        inputSchema: { type: 'object', properties: {} },
        run: async () => ({
          content: [
            { type: 'text', text: 'a picture' },
            { type: 'image', dataUrl: 'data:image/png;base64,AA==' }
          ]
        })
      }
    ]
  }
  let registry: ToolRegistry
  registry = new ToolRegistry([lab, batchTools(() => registry)])
  return { registry, log }
}

function call(registry: ToolRegistry, args: unknown): Promise<ToolResult> {
  return registry.call({ namespace: 'tool_batch', tool: 'run', arguments: args }, context)
}

function batchText(result: ToolResult): string {
  assert.equal(result.content[0].type, 'text')
  return result.content[0].type === 'text' ? result.content[0].text : ''
}

test('a sequential batch runs the calls in order and reports each result under its number', async () => {
  const { registry, log } = harness()
  const result = await call(registry, {
    calls: [
      { tool: 'lab.echo', arguments: { text: 'first' } },
      { tool: 'lab.echo', arguments: { text: 'second' } }
    ]
  })
  assert.equal(result.isError, undefined)
  assert.deepEqual(log, ['echo:first', 'echo:second'])
  const text = batchText(result)
  assert.match(text, /^2 of 2 calls succeeded\./)
  assert.match(text, /\[1\] lab\.echo — ok\nechoed first/)
  assert.match(text, /\[2\] lab\.echo — ok\nechoed second/)
})

test('a bare tool name resolves when unambiguous, like a direct call', async () => {
  const { registry } = harness()
  const result = await call(registry, { calls: [{ tool: 'echo', arguments: { text: 'plain' } }] })
  assert.match(batchText(result), /\[1\] echo — ok\nechoed plain/)
})

test('after a sequential failure the remaining calls are skipped, not run', async () => {
  const { registry, log } = harness()
  const result = await call(registry, {
    calls: [
      { tool: 'lab.echo', arguments: { text: 'ran' } },
      { tool: 'lab.boom' },
      { tool: 'lab.echo', arguments: { text: 'never' } }
    ]
  })
  assert.deepEqual(log, ['echo:ran', 'boom'])
  const text = batchText(result)
  assert.match(text, /^1 of 3 calls succeeded \(1 skipped\)\./)
  assert.match(text, /\[2\] lab\.boom — failed\nit broke/)
  assert.match(text, /\[3\] lab\.echo — skipped: call \[2\] failed and the batch is sequential/)
  // One call survived, so the batch is not an error; the model needs its result.
  assert.equal(result.isError, undefined)
})

test('a parallel batch runs everything despite failures and keeps input order', async () => {
  const { registry, log } = harness()
  const result = await call(registry, {
    parallel: true,
    calls: [
      { tool: 'lab.boom' },
      { tool: 'lab.echo', arguments: { text: 'still runs' } }
    ]
  })
  assert.ok(log.includes('echo:still runs'))
  const text = batchText(result)
  assert.match(text, /\[1\] lab\.boom — failed[\s\S]*\[2\] lab\.echo — ok/)
})

test('a batch where every call fails is itself an error', async () => {
  const { registry } = harness()
  const result = await call(registry, { parallel: true, calls: [{ tool: 'lab.boom' }, { tool: 'lab.boom' }] })
  assert.equal(result.isError, true)
  assert.match(batchText(result), /^0 of 2 calls succeeded\./)
})

test('unknown tools and switched-off tools fail their call with the standard registry message', async () => {
  const { registry } = harness()
  registry.setEnabled('lab.boom', false)
  const result = await call(registry, {
    calls: [
      { tool: 'lab.nothing' },
      { tool: 'lab.boom' },
      { tool: 'lab.echo', arguments: { text: 'x' } }
    ],
    parallel: true
  })
  const text = batchText(result)
  assert.match(text, /\[1\] lab\.nothing — failed\nUnknown tool: lab\.nothing/)
  assert.match(text, /\[2\] lab\.boom — failed\nlab\.boom is switched off/)
  assert.match(text, /\[3\] lab\.echo — ok/)
})

test('batches cannot nest', async () => {
  const { registry } = harness()
  for (const tool of ['tool_batch.run', 'run']) {
    const result = await call(registry, { calls: [{ tool }] })
    assert.equal(result.isError, true)
    assert.match(batchText(result), /batches cannot nest/)
  }
})

test('the batch size is bounded at both ends', async () => {
  const { registry } = harness()
  const empty = await call(registry, { calls: [] })
  assert.equal(empty.isError, true)
  assert.match(batchText(empty), /at least one call/)

  const oversized = await call(registry, {
    calls: Array.from({ length: MAX_BATCH_CALLS + 1 }, () => ({ tool: 'lab.echo', arguments: { text: 'x' } }))
  })
  assert.equal(oversized.isError, true)
  assert.match(batchText(oversized), /the limit is 8/)
})

test('malformed entries are refused by the schema before anything runs', async () => {
  const { registry, log } = harness()
  const result = await call(registry, { calls: [{ arguments: { text: 'no tool named' } }] })
  assert.equal(result.isError, true)
  assert.match(batchText(result), /invalid arguments/)
  assert.deepEqual(log, [])
})

test('images from inner calls are re-attached after the combined text, in call order', async () => {
  const { registry } = harness()
  const result = await call(registry, {
    calls: [
      { tool: 'lab.snap' },
      { tool: 'lab.echo', arguments: { text: 'tail' } }
    ]
  })
  const text = batchText(result)
  assert.match(text, /\[1\] lab\.snap — ok\na picture\n\(1 image attached below, in call order\)/)
  assert.deepEqual(result.content[1], { type: 'image', dataUrl: 'data:image/png;base64,AA==' })
})

test('each inner call is reported to telemetry with a batch-suffixed call id', async () => {
  const { registry } = harness()
  const callIds: string[] = []
  registry.subscribe((record) => { callIds.push(`${record.toolId}@${record.callId}`) })
  await call(registry, {
    calls: [
      { tool: 'lab.echo', arguments: { text: 'a' } },
      { tool: 'lab.echo', arguments: { text: 'b' } }
    ]
  })
  assert.deepEqual(callIds, ['lab.echo@c#1', 'lab.echo@c#2', 'tool_batch.run@c'])
})
