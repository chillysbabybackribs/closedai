import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolRegistry } from '../registry.js'
import { textResult, type ToolNamespace, type ToolResult } from '../tool.js'
import { DEFAULT_BATCH_MAX_CALLS } from '../../batch-config.ts'
import { batchTools } from './index.js'

// Every test drives the batch through registry.call — the same path the Codex adapter
// uses — so its schema validation, switches, and telemetry are part of what is verified.

const context = { threadId: 't', turnId: 'u', callId: 'c' }

function harness(maxCalls?: number): { registry: ToolRegistry; log: string[] } {
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
      }
    ]
  }
  let registry: ToolRegistry
  registry = new ToolRegistry([lab, batchTools(() => registry, { maxCalls })])
  return { registry, log }
}

function call(registry: ToolRegistry, args: unknown): Promise<ToolResult> {
  return registry.call({ namespace: 'tool_batch', tool: 'run', arguments: args }, context)
}

function batchText(result: ToolResult): string {
  return result.content.flatMap((item) => item.type === 'text' ? [item.text] : []).join('\n\n')
}

function browserHarness(): { registry: ToolRegistry; starts: string[]; release: (id: string) => void } {
  const starts: string[] = []
  const pending = new Map<string, () => void>()
  const browser: ToolNamespace = {
    name: 'browser_cdp',
    description: 'Browser automation',
    tools: [{
      name: 'protocol',
      description: 'Test target work',
      inputSchema: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['command'] }, tab_id: { type: 'string' }, id: { type: 'string' } },
        required: ['action', 'id']
      },
      run: async (input) => await new Promise<ToolResult>((resolve) => {
        const id = String(input.id)
        starts.push(id)
        pending.set(id, () => resolve(textResult(id)))
      })
    }]
  }
  const page: ToolNamespace = {
    name: 'embedded_browser',
    description: 'Browser reads',
    tools: [{
      name: 'page',
      description: 'Test page work',
      inputSchema: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['read_page'] }, tab_id: { type: 'string' }, id: { type: 'string' } },
        required: ['action', 'id']
      },
      run: async (input) => await new Promise<ToolResult>((resolve) => {
        const id = String(input.id)
        starts.push(id)
        pending.set(id, () => resolve(textResult(id)))
      })
    }]
  }
  let registry: ToolRegistry
  registry = new ToolRegistry([browser, page, batchTools(() => registry)])
  return {
    registry,
    starts,
    release: (id) => {
      const resolve = pending.get(id)
      if (!resolve) throw new Error(`No pending browser call ${id}`)
      pending.delete(id)
      resolve()
    }
  }
}

function inputPolicyHarness(): { registry: ToolRegistry; log: string[] } {
  const log: string[] = []
  const namespaces: ToolNamespace[] = [
    {
      name: 'browser_cdp',
      description: 'Browser interaction',
      tools: [{
        name: 'page',
        description: 'Page actions',
        inputSchema: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] },
        run: async (input) => { log.push(String(input.action)); return textResult(String(input.action)) }
      }]
    },
    {
      name: 'embedded_browser',
      description: 'Browser reads',
      tools: [{
        name: 'page',
        description: 'Read actions',
        inputSchema: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] },
        run: async (input) => { log.push(String(input.action)); return textResult(String(input.action)) }
      }]
    }
  ]
  let registry: ToolRegistry
  registry = new ToolRegistry([...namespaces, batchTools(() => registry)])
  return { registry, log }
}

async function waitForStart(starts: readonly string[], expected: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (starts.includes(expected)) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  assert.fail(`Timed out waiting for ${expected}; started: ${starts.join(', ')}`)
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

test('a tool the app does not own fails the whole batch before anything runs', async () => {
  const { registry, log } = harness()
  const result = await call(registry, {
    calls: [
      { tool: 'lab.echo', arguments: { text: 'would run' } },
      { tool: 'Grep', arguments: { pattern: 'x' } }
    ]
  })
  assert.equal(result.isError, true)
  assert.deepEqual(log, [])
  const text = batchText(result)
  assert.match(text, /\[2\] "Grep" is not a tool this app owns, so nothing ran/)
  // The model is told what it may batch, and where its own tools have to go instead.
  assert.match(text, /A batch can only run: lab\.echo, lab\.boom\./)
  assert.match(text, /call those directly/)
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

test('a stale-target failure keeps its recovery text local while a parallel sibling succeeds', async () => {
  const tabs: ToolNamespace = {
    name: 'embedded_browser',
    description: 'Browser reads',
    tools: [{
      name: 'page',
      description: 'Read a page',
      inputSchema: {
        type: 'object',
        properties: { action: { type: 'string' }, tab_id: { type: 'string' } },
        required: ['action', 'tab_id']
      },
      run: async (input) => input.tab_id === 'stale'
        ? { content: [{ type: 'text', text: 'No tab with id stale. Open tabs: tab-1 "A".' }], isError: true }
        : textResult(`read ${String(input.tab_id)}`)
    }]
  }
  let registry: ToolRegistry
  registry = new ToolRegistry([tabs, batchTools(() => registry)])
  const result = await call(registry, {
    parallel: true,
    calls: [
      { tool: 'embedded_browser.page', arguments: { action: 'read_page', tab_id: 'stale' } },
      { tool: 'embedded_browser.page', arguments: { action: 'read_page', tab_id: 'tab-1' } }
    ]
  })

  assert.equal(result.isError, undefined)
  assert.match(batchText(result), /\[1\] embedded_browser\.page — failed\nNo tab with id stale[\s\S]*\[2\] embedded_browser\.page — ok\nread tab-1/)
})

test('real-input fallbacks require a sequential batch with a later verification read', async () => {
  const { registry, log } = inputPolicyHarness()
  const click = {
    tool: 'browser_cdp.page',
    arguments: { action: 'click', ref: 'p1:e1', fallback_reason: 'No API exists.' }
  }
  const verify = { tool: 'embedded_browser.page', arguments: { action: 'read_page' } }

  const parallel = await call(registry, { parallel: true, calls: [click, verify] })
  assert.equal(parallel.isError, true)
  assert.match(batchText(parallel), /sequential batch/)

  const unverified = await call(registry, { calls: [verify, click] })
  assert.equal(unverified.isError, true)
  assert.match(batchText(unverified), /later read or wait action/)
  assert.deepEqual(log, [])

  const verified = await call(registry, { calls: [click, verify] })
  assert.equal(verified.isError, undefined)
  assert.deepEqual(log, ['click', 'read_page'])
})

test('parallel batches serialize work on one explicit browser tab while other tabs run immediately', async () => {
  const { registry, starts, release } = browserHarness()
  const run = call(registry, {
    parallel: true,
    calls: [
      { tool: 'browser_cdp.protocol', arguments: { action: 'command', tab_id: 'tab-a', id: 'a1' } },
      { tool: 'browser_cdp.protocol', arguments: { action: 'command', tab_id: 'tab-a', id: 'a2' } },
      { tool: 'browser_cdp.protocol', arguments: { action: 'command', tab_id: 'tab-b', id: 'b1' } }
    ]
  })
  await waitForStart(starts, 'a1')
  await waitForStart(starts, 'b1')
  assert.equal(starts.includes('a2'), false)
  release('a1')
  await waitForStart(starts, 'a2')
  release('a2')
  release('b1')
  await run
})

test('a page read stays ordered behind a mutation on the same explicit tab', async () => {
  const { registry, starts, release } = browserHarness()
  const run = call(registry, {
    parallel: true,
    calls: [
      { tool: 'browser_cdp.protocol', arguments: { action: 'command', tab_id: 'tab-a', id: 'mutate' } },
      { tool: 'embedded_browser.page', arguments: { action: 'read_page', tab_id: 'tab-a', id: 'read' } },
      { tool: 'embedded_browser.page', arguments: { action: 'read_page', tab_id: 'tab-b', id: 'other' } }
    ]
  })
  await waitForStart(starts, 'mutate')
  await waitForStart(starts, 'other')
  assert.equal(starts.includes('read'), false)
  release('mutate')
  await waitForStart(starts, 'read')
  release('read')
  release('other')
  await run
})

test('an active-tab browser call serializes every browser lane in its batch', async () => {
  const { registry, starts, release } = browserHarness()
  const run = call(registry, {
    parallel: true,
    calls: [
      { tool: 'browser_cdp.protocol', arguments: { action: 'command', tab_id: 'tab-a', id: 'a' } },
      { tool: 'browser_cdp.protocol', arguments: { action: 'command', id: 'active' } },
      { tool: 'browser_cdp.protocol', arguments: { action: 'command', tab_id: 'tab-b', id: 'b' } }
    ]
  })
  await waitForStart(starts, 'a')
  assert.deepEqual(starts, ['a'])
  release('a')
  await waitForStart(starts, 'active')
  release('active')
  await waitForStart(starts, 'b')
  release('b')
  await run
})

test('an aborted parallel batch does not dispatch queued work in a same-tab lane', async () => {
  const { registry, starts } = browserHarness()
  const controller = new AbortController()
  const batch = registry.find('tool_batch', 'run')
  assert.ok(batch)
  const run = batch.run({
    parallel: true,
    calls: [
      { tool: 'browser_cdp.protocol', arguments: { action: 'command', tab_id: 'tab-a', id: 'a1' } },
      { tool: 'browser_cdp.protocol', arguments: { action: 'command', tab_id: 'tab-a', id: 'a2' } }
    ]
  }, { ...context, signal: controller.signal })
  await waitForStart(starts, 'a1')
  controller.abort()
  const result = await run

  assert.deepEqual(starts, ['a1'])
  assert.match(batchText(result), /\[1\] browser_cdp\.protocol — failed\nbrowser_cdp\.protocol: cancelled because its parent call ended/)
  assert.match(batchText(result), /\[2\] browser_cdp\.protocol — skipped: the batch timed out/)
})

test('a batch where every call fails is itself an error', async () => {
  const { registry } = harness()
  const result = await call(registry, { parallel: true, calls: [{ tool: 'lab.boom' }, { tool: 'lab.boom' }] })
  assert.equal(result.isError, true)
  assert.match(batchText(result), /^0 of 2 calls succeeded\./)
})

test('switched-off tools fail their own call with the standard registry message', async () => {
  const { registry } = harness()
  registry.setEnabled('lab.boom', false)
  const result = await call(registry, {
    calls: [
      { tool: 'lab.boom' },
      { tool: 'lab.echo', arguments: { text: 'x' } }
    ],
    parallel: true
  })
  const text = batchText(result)
  // A switched-off tool exists, so it is the call that fails, not the batch: the rest still runs.
  assert.match(text, /\[1\] lab\.boom — failed\nlab\.boom is switched off/)
  assert.match(text, /\[2\] lab\.echo — ok/)
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
    calls: Array.from({ length: DEFAULT_BATCH_MAX_CALLS + 1 }, () => ({ tool: 'lab.echo', arguments: { text: 'x' } }))
  })
  assert.equal(oversized.isError, true)
  assert.match(batchText(oversized), /the limit is 16/)
})

test('a configured batch limit shapes both advertising and enforcement', async () => {
  const { registry } = harness(24)
  const tool = registry.namespaces.find((namespace) => namespace.name === 'tool_batch')?.tools[0]
  const properties = tool?.inputSchema.properties as Record<string, { description?: string }> | undefined
  assert.match(tool?.description ?? '', /up to 24 tool calls/)
  assert.match(String(properties?.calls.description), /1 and 24/)

  const oversized = await call(registry, {
    calls: Array.from({ length: 25 }, () => ({ tool: 'lab.echo', arguments: { text: 'x' } }))
  })
  assert.equal(oversized.isError, true)
  assert.match(batchText(oversized), /the limit is 24/)
})

test('malformed entries are refused by the schema before anything runs', async () => {
  const { registry, log } = harness()
  const result = await call(registry, { calls: [{ arguments: { text: 'no tool named' } }] })
  assert.equal(result.isError, true)
  assert.match(batchText(result), /invalid arguments/)
  assert.deepEqual(log, [])
})

test('each inner call is reported to aggregate telemetry', async () => {
  const { registry } = harness()
  const events: string[] = []
  registry.subscribe((record) => { events.push(`${record.toolId}:${record.action ?? 'call'}:${record.ok}`) })
  await call(registry, {
    calls: [
      { tool: 'lab.echo', arguments: { text: 'a' } },
      { tool: 'lab.echo', arguments: { text: 'b' } }
    ]
  })
  assert.deepEqual(events, [
    'lab.echo:call:true',
    'lab.echo:call:true',
    'tool_batch.run:call:true'
  ])
})
