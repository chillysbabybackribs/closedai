import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ToolCallEvent } from '../../shared/tools.js'
import { ToolRegistry } from './registry.js'
import { textResult, timeoutResult } from './tool.js'
import { ToolTelemetry } from './telemetry.js'

const record = (overrides: Partial<ToolCallEvent> = {}): ToolCallEvent => ({
  toolId: 'ns.tool', action: null, ok: true, timedOut: false, misuse: false, ...overrides
})

test('telemetry keeps aggregate run, failure, and timeout counts separately', () => {
  const telemetry = ToolTelemetry.ephemeral()
  telemetry.record(record())
  telemetry.record(record({ action: 'read', ok: false }))
  telemetry.record(record({ action: 'write' }))
  telemetry.record(record({ action: 'read', ok: false, timedOut: true }))

  assert.deepEqual(telemetry.snapshot(), {
    totalCalls: 4,
    stats: [
      { toolId: 'ns.tool', action: null, calls: 4, failures: 1, timeouts: 1, misuses: 0 },
      { toolId: 'ns.tool', action: 'read', calls: 2, failures: 1, timeouts: 1, misuses: 0 },
      { toolId: 'ns.tool', action: 'write', calls: 1, failures: 0, timeouts: 0, misuses: 0 }
    ]
  })
})

test('aggregate counters persist without per-call content and clear cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-telemetry-'))
  const file = join(dir, 'tool-telemetry.json')
  try {
    const telemetry = await ToolTelemetry.open(file)
    telemetry.record(record({ action: 'type' }))
    telemetry.record(record({ action: 'type', ok: false }))
    await new Promise((resolve) => setTimeout(resolve, 50))

    const contents = await readFile(file, 'utf8')
    const persisted = JSON.parse(contents) as { stats: unknown[]; totalCalls: number }
    assert.equal(persisted.totalCalls, 2)
    assert.equal(persisted.stats.length, 2)
    assert.doesNotMatch(contents, /arguments|output|thread|turn|callId|duration|error\s*:/i)
    assert.equal((await stat(file)).mode & 0o777, 0o600)

    const reopened = await ToolTelemetry.open(file)
    assert.deepEqual(reopened.snapshot(), telemetry.snapshot())
    await reopened.clear()
    assert.deepEqual(reopened.snapshot(), { stats: [], totalCalls: 0 })
    assert.deepEqual((await ToolTelemetry.open(file)).snapshot(), { stats: [], totalCalls: 0 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('opening aggregate telemetry migrates counters and removes the text-bearing legacy log', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-telemetry-'))
  const file = join(dir, 'tool-telemetry.json')
  const legacy = join(dir, 'tool-telemetry.jsonl')
  try {
    await writeFile(legacy, [
      JSON.stringify({ type: 'tool_registered', tool: { toolId: 'ns.tool' } }),
      JSON.stringify({ id: 'a', toolId: 'ns.tool', action: 'type', ok: true, argumentsPreview: '{"text":"PRIVATE_VALUE"}', outputPreview: 'PRIVATE_VALUE' }),
      JSON.stringify({ id: 'b', toolId: 'ns.tool', action: 'type', ok: false, error: 'PRIVATE_ERROR' })
    ].join('\n'))

    const telemetry = await ToolTelemetry.open(file, legacy)
    assert.deepEqual(telemetry.snapshot(), {
      totalCalls: 2,
      stats: [
        { toolId: 'ns.tool', action: null, calls: 2, failures: 1, timeouts: 0, misuses: 0 },
        { toolId: 'ns.tool', action: 'type', calls: 2, failures: 1, timeouts: 0, misuses: 0 }
      ]
    })
    const contents = await readFile(file, 'utf8')
    assert.doesNotMatch(contents, /PRIVATE_VALUE|PRIVATE_ERROR|argumentsPreview|outputPreview/)
    await assert.rejects(access(legacy))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the registry reports aggregate-only events for successes, failures, and unknown tools', async () => {
  const registry = new ToolRegistry([{
    name: 'ns',
    description: 'd',
    tools: [{
      name: 'echo',
      description: 'echoes',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      run: async (input) => input.text === 'timeout' ? timeoutResult('not ready') : textResult(String(input.text))
    }]
  }])
  const seen: ToolCallEvent[] = []
  const stop = registry.subscribe((entry) => seen.push(entry))
  const context = { threadId: 't', turnId: 'u', callId: 'c1' }
  await registry.call({ namespace: 'ns', tool: 'echo', arguments: { text: 'PRIVATE_VALUE', action: 'say' } }, context)
  await registry.call({ namespace: 'ns', tool: 'echo', arguments: {} }, context)
  await registry.call({ namespace: 'ns', tool: 'echo', arguments: { text: 'timeout' } }, context)
  await registry.call({ namespace: 'ns', tool: 'nope', arguments: {} }, context)
  stop()

  assert.deepEqual(seen, [
    { toolId: 'ns.echo', action: 'say', ok: true, timedOut: false, misuse: false },
    // Missing a required argument and naming a tool that does not exist are both the app
    // refusing the call, so they are misuse rather than the tool failing at runtime.
    { toolId: 'ns.echo', action: null, ok: false, timedOut: false, misuse: true },
    { toolId: 'ns.echo', action: null, ok: false, timedOut: true, misuse: false },
    { toolId: 'ns.nope', action: null, ok: false, timedOut: false, misuse: true }
  ])
  assert.doesNotMatch(JSON.stringify(seen), /PRIVATE_VALUE|required|unknown/i)
})
