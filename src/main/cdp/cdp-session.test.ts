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
  readonly debugger = new FakeDebugger()
  destroyed = false

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

test('destroying WebContents notifies its owner exactly once', () => {
  const contents = new FakeContents()
  const closed: CdpSession[] = []
  const session = new CdpSession('tab-1', contents as unknown as WebContents, (entry) => closed.push(entry))
  contents.destroyed = true
  contents.emit('destroyed')
  contents.emit('destroyed')
  assert.deepEqual(closed, [session])
  assert.throws(() => session.ensureAttached(), /closed/)
})
