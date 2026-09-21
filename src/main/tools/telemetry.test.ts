import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ToolCallEvent } from '../../shared/tools.js'
import { ToolRegistry } from './registry.js'
import { textResult, timeoutResult } from './tool.js'
import { ToolTelemetry } from './telemetry.js'

const T0 = 1_700_000_000_000
const record = (overrides: Partial<ToolCallEvent> = {}): ToolCallEvent => ({
  toolId: 'ns.tool', action: null, ok: true, timedOut: false, misuse: false, at: T0, message: null, ...overrides
})

test('telemetry keeps aggregate run, failure, and timeout counts separately, with last-use times', () => {
  const telemetry = ToolTelemetry.ephemeral()
  telemetry.record(record())
  telemetry.record(record({ action: 'read', ok: false, at: T0 + 1, message: 'boom' }))
  telemetry.record(record({ action: 'write', at: T0 + 2 }))
  telemetry.record(record({ action: 'read', ok: false, timedOut: true, at: T0 + 3, message: 'not ready' }))

  const snapshot = telemetry.snapshot()
  assert.equal(snapshot.totalCalls, 4)
  assert.ok(snapshot.since !== null && snapshot.since <= Date.now())
  assert.deepEqual(snapshot.stats, [
    { toolId: 'ns.tool', action: null, calls: 4, failures: 1, timeouts: 1, misuses: 0, lastCalledAt: T0 + 3, lastFailedAt: T0 + 3 },
    { toolId: 'ns.tool', action: 'read', calls: 2, failures: 1, timeouts: 1, misuses: 0, lastCalledAt: T0 + 3, lastFailedAt: T0 + 3 },
    { toolId: 'ns.tool', action: 'write', calls: 1, failures: 0, timeouts: 0, misuses: 0, lastCalledAt: T0 + 2, lastFailedAt: null }
  ])
  assert.deepEqual(snapshot.errors, [
    { toolId: 'ns.tool', action: 'read', at: T0 + 3, kind: 'timeout', message: 'not ready' },
    { toolId: 'ns.tool', action: 'read', at: T0 + 1, kind: 'error', message: 'boom' }
  ])
})

test('error notes keep the newest few per tool and nothing for successes', () => {
  const telemetry = ToolTelemetry.ephemeral()
  for (let i = 0; i < 5; i += 1) telemetry.record(record({ ok: false, at: T0 + i, message: `fail ${i}` }))
  telemetry.record(record({ toolId: 'ns.other', ok: false, misuse: true, at: T0 + 9, message: 'refused' }))
  telemetry.record(record({ toolId: 'ns.other', ok: true, at: T0 + 10, message: 'ignored' }))

  const errors = telemetry.snapshot().errors
  assert.deepEqual(errors.map((note) => [note.toolId, note.kind, note.message]), [
    ['ns.other', 'misuse', 'refused'], ['ns.tool', 'error', 'fail 4'], ['ns.tool', 'error', 'fail 3'], ['ns.tool', 'error', 'fail 2']
  ])
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
    assert.doesNotMatch(contents, /arguments|output|thread|turn|callId|duration/i)
    assert.equal((await stat(file)).mode & 0o777, 0o600)

    const reopened = await ToolTelemetry.open(file)
    assert.deepEqual(reopened.snapshot(), telemetry.snapshot())
    await reopened.clear()
    assert.deepEqual(reopened.snapshot().stats, [])
    assert.deepEqual((await ToolTelemetry.open(file)).snapshot().totalCalls, 0)
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
    // Legacy lines carry no timestamps, so migrated counters have none and counting starts now.
    const { since, errors, ...migrated } = telemetry.snapshot()
    assert.ok(since !== null && since <= Date.now())
    assert.deepEqual(errors, [])
    assert.deepEqual(migrated, {
      totalCalls: 2,
      stats: [
        { toolId: 'ns.tool', action: null, calls: 2, failures: 1, timeouts: 0, misuses: 0, lastCalledAt: null, lastFailedAt: null },
        { toolId: 'ns.tool', action: 'type', calls: 2, failures: 1, timeouts: 0, misuses: 0, lastCalledAt: null, lastFailedAt: null }
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

  assert.deepEqual(seen.map(({ at, message, ...rest }) => rest), [
    { toolId: 'ns.echo', action: 'say', ok: true, timedOut: false, misuse: false },
    // Missing a required argument and naming a tool that does not exist are both the app
    // refusing the call, so they are misuse rather than the tool failing at runtime.
    { toolId: 'ns.echo', action: null, ok: false, timedOut: false, misuse: true },
    { toolId: 'ns.echo', action: null, ok: false, timedOut: true, misuse: false },
    { toolId: 'ns.nope', action: null, ok: false, timedOut: false, misuse: true }
  ])
  assert.ok(seen.every((entry) => entry.at > 0))
  // A success carries no message; a failure carries the first line the model was told, and
  // never an argument value.
  assert.equal(seen[0]!.message, null)
  assert.ok(seen.slice(1).every((entry) => typeof entry.message === 'string' && entry.message.length <= 240))
  assert.doesNotMatch(JSON.stringify(seen), /PRIVATE_VALUE/)
})

test('bursts share one pending write and clear waits for changes made during an active write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'closedai-telemetry-burst-'))
  try {
    const telemetry = await ToolTelemetry.open(join(dir, 'stats.json'))
    const snapshots: number[] = []
    const releases: Array<() => void> = []
    Object.assign(telemetry, { persistNow: () => {
      snapshots.push(telemetry.snapshot().totalCalls)
      return new Promise<void>((resolve) => releases.push(resolve))
    } })
    for (let i = 0; i < 100; i++) telemetry.record(record())
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.deepEqual(snapshots, [100])

    for (let i = 0; i < 100; i++) telemetry.record(record())
    releases.shift()!()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.deepEqual(snapshots, [100, 200])

    let cleared = false
    const clearing = telemetry.clear().then(() => { cleared = true })
    assert.equal(cleared, false)
    releases.shift()!()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.deepEqual(snapshots, [100, 200, 0])
    assert.equal(cleared, false)
    releases.shift()!()
    await clearing
    assert.equal(cleared, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
