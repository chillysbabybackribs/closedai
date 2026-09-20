import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { WebContents } from 'electron'
import { CdpSession } from './cdp-session.ts'

class FakeDebugger extends EventEmitter {
  attached = false
  attachCount = 0
  readonly commands: Array<[string, Record<string, unknown>, string | undefined]> = []

  attach(): void {
    this.attached = true
    this.attachCount += 1
  }

  isAttached(): boolean {
    return this.attached
  }

  detach(): void {
    this.attached = false
    this.emit('detach', {}, 'target closed')
  }

  async sendCommand(method: string, params: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    this.commands.push([method, params, sessionId])
    return { method, ok: true }
  }
}

class FakeContents extends EventEmitter {
  readonly id = 17
  private readonly fakeDebugger = new FakeDebugger()
  destroyed = false

  get debugger(): FakeDebugger {
    if (this.destroyed) throw new TypeError('Object has been destroyed')
    return this.fakeDebugger
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
}

test('CDP session attaches lazily and routes flat child-session commands', async () => {
  const contents = new FakeContents()
  const session = new CdpSession('tab-1', contents as unknown as WebContents)
  assert.equal(contents.debugger.attachCount, 0)

  const result = await session.command('Runtime.evaluate', { expression: '2 + 2' }, 'child-7')
  assert.deepEqual(result, { method: 'Runtime.evaluate', ok: true })
  assert.equal(contents.debugger.attachCount, 1)
  assert.deepEqual(contents.debugger.commands, [
    ['Target.setDiscoverTargets', { discover: true }, undefined],
    ['Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: true }, undefined],
    ['Runtime.evaluate', { expression: '2 + 2' }, 'child-7']
  ])

  await session.command('Page.getFrameTree')
  assert.equal(contents.debugger.attachCount, 1)
  session.dispose()
  assert.equal(contents.debugger.attached, false)
})

test('CDP events are cursor-based, filterable, and preserve child session ids', () => {
  const contents = new FakeContents()
  const session = new CdpSession('tab-1', contents as unknown as WebContents)
  session.ensureAttached()
  contents.debugger.emit('message', {}, 'Network.requestWillBeSent', { requestId: '1' })
  contents.debugger.emit('message', {}, 'Runtime.consoleAPICalled', { type: 'log' }, 'child-2')

  const first = session.eventPage(0, 10)
  assert.deepEqual(first.events.map(({ cursor, method, sessionId }) => ({ cursor, method, sessionId })), [
    { cursor: 1, method: 'Network.requestWillBeSent', sessionId: null },
    { cursor: 2, method: 'Runtime.consoleAPICalled', sessionId: 'child-2' }
  ])
  assert.equal(first.nextCursor, 2)

  const network = session.eventPage(0, 10, 'Network.')
  assert.equal(network.events.length, 1)
  assert.equal(network.events[0].method, 'Network.requestWillBeSent')
  assert.equal(session.eventPage(first.nextCursor, 10).events.length, 0)
})

test('CDP event history is bounded and marks oversized event parameters', () => {
  const contents = new FakeContents()
  const session = new CdpSession('tab-1', contents as unknown as WebContents)
  session.ensureAttached()
  contents.debugger.emit('message', {}, 'Page.screencastFrame', { data: 'x'.repeat(70_000) })
  for (let index = 0; index < 1_000; index += 1) {
    contents.debugger.emit('message', {}, 'Network.dataReceived', { index })
  }

  const page = session.eventPage(0, 200)
  assert.equal(page.oldestCursor, 2)
  assert.equal(page.missedEvents, true)
  assert.equal(page.events.length, 200)
  session.dispose()
})

test('a debugger detach is observable and the next command reattaches', async () => {
  const contents = new FakeContents()
  const session = new CdpSession('tab-1', contents as unknown as WebContents)
  session.ensureAttached()
  contents.debugger.detach()
  assert.equal(session.eventPage(0, 10).events[0].method, 'closedai.debuggerDetached')
  await session.command('Browser.getVersion')
  assert.equal(contents.debugger.attachCount, 2)
  session.dispose()
})

test('target inventory follows creation, attachment, navigation, detachment, and destruction', () => {
  const contents = new FakeContents()
  const session = new CdpSession('tab-1', contents as unknown as WebContents)
  session.ensureAttached()
  const targetInfo = { targetId: 'worker-1', type: 'worker', title: 'Worker', url: 'https://one.test/worker.js' }
  contents.debugger.emit('message', {}, 'Target.targetCreated', { targetInfo })
  contents.debugger.emit('message', {}, 'Target.attachedToTarget', {
    sessionId: 'child-1', targetInfo, waitingForDebugger: true
  })
  contents.debugger.emit('message', {}, 'Target.targetInfoChanged', {
    targetInfo: { ...targetInfo, url: 'https://one.test/worker-v2.js' }
  })
  assert.deepEqual(session.targetInventory(), [{
    targetId: 'worker-1', type: 'worker', title: 'Worker', url: 'https://one.test/worker-v2.js',
    attached: true, sessionId: 'child-1', openerId: null, subtype: null, waitingForDebugger: true
  }])

  contents.debugger.emit('message', {}, 'Target.detachedFromTarget', { sessionId: 'child-1' })
  assert.equal(session.targetInventory()[0]?.sessionId, null)
  assert.equal(session.targetInventory()[0]?.attached, false)
  contents.debugger.emit('message', {}, 'Target.targetDestroyed', { targetId: 'worker-1' })
  assert.deepEqual(session.targetInventory(), [])
  session.dispose()
})

test('event cursors reset safely when they came from an older connection', () => {
  const contents = new FakeContents()
  const session = new CdpSession('tab-1', contents as unknown as WebContents)
  session.ensureAttached()
  contents.debugger.emit('message', {}, 'Page.loadEventFired', {})
  const page = session.eventPage(900, 10)
  assert.equal(page.missedEvents, true)
  assert.equal(page.events[0].method, 'Page.loadEventFired')
  assert.equal(page.nextCursor, 1)
  session.dispose()
})

test('destroying WebContents does not access the destroyed target and notifies its owner exactly once', () => {
  const contents = new FakeContents()
  const closed: CdpSession[] = []
  const session = new CdpSession('tab-1', contents as unknown as WebContents, (entry) => closed.push(entry))
  contents.destroyed = true
  contents.emit('destroyed')
  contents.emit('destroyed')
  assert.deepEqual(closed, [session])
  assert.throws(() => session.ensureAttached(), /closed/)
})

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

test('child targets auto-attach their own children, receive leased directives before resuming, and are released exactly', async () => {
  const contents = new FakeContents()
  const session = new CdpSession('tab-1', contents as unknown as WebContents)
  const frame = { targetId: 'frame-1', type: 'iframe', title: '', url: 'https://ads.test/frame' }
  const worker = { targetId: 'worker-1', type: 'worker', title: '', url: 'https://one.test/worker.js' }
  session.ensureAttached()
  contents.debugger.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'frame-s', targetInfo: frame, waitingForDebugger: false })
  await settle()
  const frameCommands = () => contents.debugger.commands.filter(([, , sessionId]) => sessionId === 'frame-s').map(([method]) => method)
  assert.deepEqual(frameCommands(), ['Target.setAutoAttach'], 'an attached document target auto-attaches its own children')

  const released: string[] = []
  const now = await session.lease('network', {
    types: ['iframe', 'worker'],
    apply: async (send, target) => { await send('Network.enable'); return `armed:${target.targetId}` },
    release: async (_send, target) => { released.push(target.targetId) }
  })
  assert.deepEqual(now.map((outcome) => [outcome.sessionId, outcome.state, outcome.error]), [['frame-s', 'armed:frame-1', undefined]])
  assert.deepEqual(frameCommands(), ['Target.setAutoAttach', 'Network.enable'])

  contents.debugger.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'worker-s', targetInfo: worker, waitingForDebugger: true })
  await settle()
  const workerCommands = contents.debugger.commands.filter(([, , sessionId]) => sessionId === 'worker-s').map(([method]) => method)
  assert.deepEqual(workerCommands, ['Network.enable', 'Runtime.runIfWaitingForDebugger'], 'a paused worker gets the directive, then resumes; workers do not auto-attach')
  assert.deepEqual(session.childOutcomes('network').map((outcome) => outcome.state), ['armed:frame-1', 'armed:worker-1'])

  contents.debugger.emit('message', {}, 'Target.detachedFromTarget', { sessionId: 'worker-s' })
  assert.deepEqual(session.childOutcomes('network').map((outcome) => outcome.sessionId), ['frame-s'])
  const gone = await session.release('network')
  assert.deepEqual(gone.map((outcome) => [outcome.sessionId, outcome.error]), [['frame-s', undefined]])
  assert.deepEqual(released, ['frame-1'], 'release runs once per child that still holds the directive')
  assert.deepEqual(session.childOutcomes('network'), [])
  session.dispose()
})

test('a directive that fails in one child still resumes that child and reports the error; a failed release is reported', async () => {
  const contents = new FakeContents()
  const failing = new Set<string>()
  contents.debugger.sendCommand = async (method, params, sessionId) => {
    contents.debugger.commands.push([method, params, sessionId])
    if (failing.has(method)) throw new Error(`${method} unsupported here`)
    return { ok: true }
  }
  const session = new CdpSession('tab-1', contents as unknown as WebContents)
  session.ensureAttached()
  await session.lease('hook', {
    types: ['iframe'],
    apply: async (send) => send('Page.addScriptToEvaluateOnNewDocument', { source: 'x' }),
    release: async (send) => { await send('Page.removeScriptToEvaluateOnNewDocument') }
  })
  failing.add('Page.addScriptToEvaluateOnNewDocument')
  contents.debugger.emit('message', {}, 'Target.attachedToTarget', {
    sessionId: 'frame-s', targetInfo: { targetId: 'frame-1', type: 'iframe', title: '', url: 'https://x.test' }, waitingForDebugger: true
  })
  await settle()
  const frameCommands = contents.debugger.commands.filter(([, , sessionId]) => sessionId === 'frame-s').map(([method]) => method)
  assert.equal(frameCommands.at(-1), 'Runtime.runIfWaitingForDebugger', 'the child resumes even though the directive failed')
  assert.match(session.childOutcomes('hook')[0]?.error ?? '', /unsupported here/)

  failing.clear()
  contents.debugger.emit('message', {}, 'Target.attachedToTarget', {
    sessionId: 'frame-t', targetInfo: { targetId: 'frame-2', type: 'iframe', title: '', url: 'https://y.test' }, waitingForDebugger: false
  })
  await settle()
  failing.add('Page.removeScriptToEvaluateOnNewDocument')
  const released = await session.release('hook')
  assert.deepEqual(released.map((outcome) => [outcome.sessionId, outcome.error?.replace(/ .*/, '')]).sort(), [['frame-s', 'Page.addScriptToEvaluateOnNewDocument'], ['frame-t', 'Page.removeScriptToEvaluateOnNewDocument']])
  session.dispose()
})
