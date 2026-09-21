// Build first. Run with the repository's TypeScript loader; no real application is targeted.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { NativeControllerClient } from '../../src/main/native-instrument/client.js'
import { NativeInstrumentService } from '../../src/main/native-instrument/service.js'
import { readTarget, ptracePolicy } from '../../src/main/native-instrument/targets.js'
import type { ProbeResult } from '../../src/main/native-instrument/contracts.js'
import { nativeInstrumentTools } from '../../src/main/tools/native-instrument/index.js'
import { ToolRegistry } from '../../src/main/tools/registry.js'

const directory = await mkdtemp(join(tmpdir(), 'closedai-native-check-'))
const binary = join(directory, 'fixture')
execFileSync('cc', ['-O0', '-g', '-rdynamic', fileURLToPath(new URL('./fixture.c', import.meta.url)), '-o', binary])
const target = spawn(binary, [], { stdio: ['pipe', 'pipe', 'inherit'] })
const lines: string[] = []
const reader = createInterface({ input: target.stdout })
reader.on('line', line => lines.push(line))
const waitLine = async (prefix: string) => {
  for (let i = 0; i < 100; i++) {
    const index = lines.findIndex(line => line.startsWith(prefix))
    if (index >= 0) return lines.splice(index, 1)[0]
    await delay(20)
  }
  throw new Error(`Fixture did not report ${prefix}`)
}
const client = new NativeControllerClient(new URL('../../out/main/native-controller.js', import.meta.url), process.env.CLOSEDAI_NATIVE_EXECUTABLE || process.execPath)
const service = new NativeInstrumentService(client)
const registry = new ToolRegistry([nativeInstrumentTools(service, () => true)])
const context = { paneId: 'native-live-check', threadId: 'fixture', turnId: 'fixture', callId: 'fixture' }
const checks: string[] = []
try {
  await waitLine('ready ')
  // Yama permits descendants of this specifically nominated tracer, including the helper.
  target.stdin.write(`authorize ${process.pid}\n`)
  assert.equal(await waitLine('authorized '), 'authorized 0')
  const identity = await readTarget(target.pid!)
  const call = async (tool: string, args: object, expectedError = false) => {
    const response = await registry.call({ namespace: 'native_instrument', tool, arguments: args }, context)
    assert.equal(!!response.isError, expectedError, JSON.stringify(response))
    const block = response.content[0]
    assert.equal(block.type, 'text')
    return JSON.parse((block as { text: string }).text)
  }
  const found = await call('query', { action: 'processes', query: binary })
  assert(found.targets.some((entry: { id: string }) => entry.id === identity.id))
  const inspect = await call('inspect', { target_id: identity.id, operation_key: 'inspect', module_query: 'fixture' })
  assert.equal(inspect.cleanup.session, 'detached')
  assert(inspect.events.some((event: { message: { payload?: { kind: string } } }) => event.message.payload?.kind === 'module'))
  checks.push('process discovery, module/thread inspection, detach')

  const args = { target_id: identity.id, operation_key: 'hook', duration_ms: 100, source: `
const address = Process.mainModule.getExportByName('fixture_add');
const call = new NativeFunction(address, 'int', ['int']);
send({kind:'baseline',value:call(5)});
Interceptor.attach(address, {
  onEnter(args) { this.input = args[0].toInt32(); },
  onLeave(value) { send({kind:'hook',input:this.input,original:value.toInt32()},new Uint8Array([1,2,3]).buffer); value.replace(99); }
});
Interceptor.flush();
send({kind:'changed',value:call(5)});
` }
  const hooked: ProbeResult = await call('probe', args)
  const payloads = hooked.events.map(event => (event.message as { payload?: { kind: string; value: number; input: number; original: number } }).payload)
  assert(payloads.some(p => p?.kind === 'baseline' && p.value === 12))
  assert(payloads.some(p => p?.kind === 'changed' && p.value === 99))
  assert(payloads.some(p => p?.kind === 'hook' && p.input === 5 && p.original === 12))
  assert(hooked.events.some(event => event.binary?.base64 === 'AQID'))
  assert.equal(hooked.cleanup.session, 'detached')
  target.stdin.write('5\n')
  assert.equal(await waitLine('value '), 'value 12')
  assert.deepEqual(await call('probe', args), hooked)
  assert.deepEqual(await call('query', { action: 'operation', operation_key: 'hook' }), hooked)
  checks.push('native arguments/return replacement, binary event, hook removal, duplicate receipt')

  const flood = await call('probe', { target_id: identity.id, operation_key: 'flood', duration_ms: 100,
    source: `for(let i=0;i<200;i++) send({i,text:'x'.repeat(300)});` })
  assert.equal(flood.received, 200)
  assert(flood.dropped > 0)
  assert.equal(flood.received, flood.events.length + flood.dropped)
  checks.push('event flood bounded with explicit loss counts')

  const stale = await call('inspect', { target_id: `${target.pid}:${'0'.repeat(64)}`, operation_key: 'stale' }, true)
  assert.equal(stale.cleanup.session, 'not-attached')
  const bad = await call('probe', { target_id: identity.id, operation_key: 'syntax', source: 'const = ;' }, true)
  assert.equal(bad.cleanup.session, 'detached')
  checks.push('stale identity refused; agent syntax error detaches')

  const abort = new AbortController()
  const pending = service.run('native-live-check', 'cancel', { targetId: identity.id, durationMs: 10_000, source: 'send({ready:true})' }, abort.signal)
  await delay(300)
  abort.abort()
  const cancelled = await pending
  assert.equal(cancelled.state, 'cancelled')
  assert.equal(cancelled.cleanup.session, 'detached')
  target.stdin.write('5\n')
  assert.equal(await waitLine('value '), 'value 12')
  checks.push('cancellation detaches and preserves target')

  const stuckAbort = new AbortController()
  const stuck = service.run('native-live-check', 'stuck', { targetId: identity.id, durationMs: 0, source: 'while(true) {}' }, stuckAbort.signal)
  await delay(300)
  stuckAbort.abort()
  const stuckResult = await stuck
  assert(['cancelled', 'unknown'].includes(stuckResult.state))
  target.stdin.write('5\n')
  assert.equal(await waitLine('value '), 'value 12')
  checks.push(`stuck agent bounded (${stuckResult.state}); target remains responsive`)

  const gone = service.run('native-live-check', 'target-exit', { targetId: identity.id, durationMs: 500, source: 'send({ready:true})' }, new AbortController().signal)
  await delay(200)
  target.stdin.end('exit\n')
  const exited = await gone
  assert.equal(exited.state, 'failed')
  checks.push('target exit reported as failure')
  console.log(JSON.stringify({ checks, ptraceScope: await ptracePolicy(), executable: process.env.CLOSEDAI_NATIVE_EXECUTABLE || process.execPath, hookedCleanup: hooked.cleanup, stuckCleanup: stuckResult.cleanup }, null, 2))
} finally {
  service.dispose()
  reader.close()
  if (target.exitCode === null) {
    target.kill('SIGKILL')
    await new Promise(resolve => target.once('exit', resolve))
  }
  await rm(directory, { recursive: true, force: true })
}
