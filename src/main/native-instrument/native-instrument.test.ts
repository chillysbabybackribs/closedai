import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { ProbeEvents } from './events.js'
import { NativeInstrumentService } from './service.js'
import { readTarget, verifyTarget } from './targets.js'
import { FRIDA_VERSION, type ProbeRequest, type ProbeResult } from './contracts.js'
import { nativeInstrumentTools } from '../tools/native-instrument/index.js'
import { ToolRegistry } from '../tools/registry.js'

const request: ProbeRequest = { targetId: 'target', source: 'send(1)', durationMs: 0 }
const result: ProbeResult = {
  state: 'completed', targetId: 'target', sourceHash: 'hash', fridaVersion: FRIDA_VERSION,
  elapsedMs: 0, events: [], received: 0, dropped: 0, truncated: 0,
  cleanup: { script: 'unloaded-or-destroyed', session: 'detached' }
}
const signal = () => new AbortController().signal

test('bounded evidence counts every received event and marks binary/text truncation', () => {
  const events = new ProbeEvents()
  events.add({ text: 'x'.repeat(3_000) }, Buffer.alloc(700, 42))
  for (let i = 0; i < 200; i++) events.add({ i })
  assert.equal(events.received, 201)
  assert.equal(events.received, events.events.length + events.dropped)
  assert.equal(events.truncated, 1)
  assert.equal(events.events[0].binary?.originalBytes, 700)
  assert.equal(Buffer.from(events.events[0].binary!.base64, 'base64').length, 512)
  assert(events.events.length <= 64)
  assert(Buffer.byteLength(JSON.stringify(events.events)) < 10_200)
})

test('duplicate operation keys share one execution; mismatched arguments and competing targets fail', async () => {
  let calls = 0
  let finish!: (value: ProbeResult) => void
  const service = new NativeInstrumentService({
    run: async () => { calls++; return new Promise(resolve => { finish = resolve }) }, dispose() {}
  })
  try {
    const first = service.run('pane', 'key', request, signal())
    const duplicate = service.run('pane', 'key', request, signal())
    assert.equal(first, duplicate)
    assert.throws(() => service.run('pane', 'key', { ...request, source: 'different' }, signal()), /different arguments/)
    assert.throws(() => service.run('other-pane', 'key', request, signal()), /already has an active/)
    assert.equal(service.read('pane', 'key').state, 'running')
    assert.equal(service.read('other-pane', 'key').state, 'not-found')
    await delay(0)
    finish(result)
    assert.deepEqual(await first, result)
    assert.deepEqual(await service.run('pane', 'key', request, signal()), result)
    assert.equal(calls, 1)
  } finally { service.dispose() }
})

test('owner cancellation and owner turn replacement reach the controller', async () => {
  let cancelled = 0
  let current = true
  const service = new NativeInstrumentService({
    run: async (_request, signal) => {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { cancelled++; resolve() }, { once: true }))
      return { ...result, state: 'cancelled' }
    }, dispose() {}
  })
  try {
    const abort = new AbortController()
    const first = service.run('pane', 'cancel', request, abort.signal)
    await delay(0)
    abort.abort()
    assert.equal((await first).state, 'cancelled')
    const second = service.run('pane', 'replaced', request, signal(), () => current)
    await delay(0)
    current = false
    assert.equal((await second).state, 'cancelled')
    assert.equal(cancelled, 2)
  } finally { service.dispose() }
})

test('controller startup failure remains a replayable unknown receipt, not running or automatically retried', async () => {
  let calls = 0
  const service = new NativeInstrumentService({ run: async () => { calls++; throw new Error('failed to fork') }, dispose() {} })
  try {
    assert.equal((await service.run('pane', 'key', request, signal())).state, 'unknown')
    assert.equal(service.read('pane', 'key').state, 'unknown')
    assert.equal((await service.run('pane', 'key', request, signal())).state, 'unknown')
    assert.equal(calls, 1)
  } finally { service.dispose() }
})

test('Linux target identity validates process birth and rejects forged receipts', { skip: process.platform !== 'linux' }, async () => {
  const target = await readTarget(process.pid)
  assert.deepEqual(await verifyTarget(target.id), target)
  await assert.rejects(verifyTarget(`${process.pid}:${'0'.repeat(64)}`), /identity changed/)
})

test('registry keeps custom source out of inspection and exposes independent switches', async () => {
  const service = new NativeInstrumentService({ run: async () => result, dispose() {} })
  try {
    const registry = new ToolRegistry([nativeInstrumentTools(service, () => true)])
    assert(registry.switchableIds().includes('native_instrument.probe'))
    const output = await registry.call({ namespace: 'native_instrument', tool: 'inspect', arguments: {
      target_id: 'target', operation_key: 'key', source: 'unwanted'
    } }, { paneId: 'pane', threadId: 'thread', turnId: 'turn', callId: 'test' })
    assert.equal(output.isError, true)
  } finally { service.dispose() }
})
