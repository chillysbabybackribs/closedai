import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ToolCallRecord } from '../../shared/tools.js'
import { ToolRegistry } from './registry.js'
import { textResult } from './tool.js'
import { ToolTelemetry, computeStats } from './telemetry.js'

function record(overrides: Partial<ToolCallRecord>): ToolCallRecord {
  return {
    id: 'r', at: 1_000, threadId: null, turnId: null, callId: 'c', toolId: 'ns.tool', action: null,
    argumentsPreview: '{}', durationMs: 10, ok: true, error: null, outputPreview: '', ...overrides
  }
}

test('computeStats aggregates per tool, newest first', () => {
  const stats = computeStats([
    record({ toolId: 'a', at: 1, durationMs: 10 }),
    record({ toolId: 'a', at: 5, durationMs: 30, ok: false, error: 'boom' }),
    record({ toolId: 'b', at: 9, durationMs: 7 })
  ])
  assert.deepEqual(stats, [
    { toolId: 'b', action: null, calls: 1, failures: 0, averageMs: 7, lastAt: 9 },
    { toolId: 'a', action: null, calls: 2, failures: 1, averageMs: 20, lastAt: 5 }
  ])
  const perAction = computeStats([
    record({ toolId: 'a', action: 'x', at: 1, ok: false }),
    record({ toolId: 'a', action: 'y', at: 2 })
  ])
  assert.deepEqual(perAction.map((stat) => [stat.toolId, stat.action, stat.calls, stat.failures]), [
    ['a', null, 2, 1], ['a', 'y', 1, 0], ['a', 'x', 1, 1]
  ])
})

test('telemetry persists as JSONL, reloads, trims to the retained window, and clears', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-telemetry-'))
  const file = join(dir, 'tool-telemetry.jsonl')
  try {
    const telemetry = await ToolTelemetry.open(file, 3)
    for (let i = 0; i < 5; i += 1) telemetry.record(record({ id: `r${i}`, at: i }))
    await telemetry.clear().then(() => undefined, () => undefined) // flush the write queue
    telemetry.record(record({ id: 'after', at: 10 }))
    // Wait for the append to land before reopening.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    assert.deepEqual(lines.map((line) => (JSON.parse(line) as ToolCallRecord).id), ['after'])

    const reopened = await ToolTelemetry.open(file, 3)
    assert.deepEqual(reopened.snapshot().recent.map((entry) => entry.id), ['after'])
    assert.equal(reopened.snapshot().retained, 3)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('telemetry keeps a durable call total and records new tool definitions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-telemetry-'))
  const file = join(dir, 'tool-telemetry.jsonl')
  try {
    const telemetry = await ToolTelemetry.open(file, 1)
    telemetry.observeTools([
      { toolId: 'alpha.lookup', namespace: 'alpha', name: 'lookup', actions: ['search', 'fetch'] },
      { toolId: 'beta.echo', namespace: 'beta', name: 'echo', actions: [] }
    ])
    telemetry.record(record({ id: 'first' }))
    telemetry.record(record({ id: 'second' }))
    assert.equal(telemetry.snapshot().totalCalls, 2)
    assert.deepEqual(telemetry.snapshot().recent.map((entry) => entry.id), ['second'])
    assert.deepEqual(telemetry.snapshot().registeredTools.map((tool) => tool.toolId), ['alpha.lookup', 'beta.echo'])
    await telemetry.clear()
    const reopened = await ToolTelemetry.open(file, 1)
    assert.equal(reopened.snapshot().totalCalls, 0)
    assert.deepEqual(reopened.snapshot().registeredTools.map((tool) => tool.toolId), ['alpha.lookup', 'beta.echo'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the registry reports every call to subscribers, including failures and unknown tools', async () => {
  const registry = new ToolRegistry([{
    name: 'ns',
    description: 'd',
    tools: [{
      name: 'echo',
      description: 'echoes',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      run: async (input) => textResult(String(input.text))
    }]
  }])
  const seen: ToolCallRecord[] = []
  const stop = registry.subscribe((entry) => seen.push(entry))
  const context = { threadId: 't', turnId: 'u', callId: 'c1' }
  await registry.call({ namespace: 'ns', tool: 'echo', arguments: { text: 'hi', action: 'say' } }, context)
  await registry.call({ namespace: 'ns', tool: 'echo', arguments: {} }, context)
  await registry.call({ namespace: 'ns', tool: 'nope', arguments: {} }, context)
  stop()
  await registry.call({ namespace: 'ns', tool: 'echo', arguments: { text: 'unseen' } }, context)

  assert.equal(seen.length, 3)
  assert.equal(seen[0].toolId, 'ns.echo')
  assert.equal(seen[0].action, 'say')
  assert.equal(seen[0].ok, true)
  assert.equal(seen[0].outputPreview, 'hi')
  assert.equal(seen[0].threadId, 't')
  assert.equal(seen[1].ok, false)
  assert.match(seen[1].error ?? '', /text is required/)
  assert.equal(seen[2].toolId, 'ns.nope')
  assert.equal(seen[2].ok, false)
})
