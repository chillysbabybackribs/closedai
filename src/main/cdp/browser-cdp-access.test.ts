import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { WebContents } from 'electron'
import type { BrowserTabInfo } from '../../shared/types.ts'
import { BrowserCdpAccess, type CdpBrowserSource, type CdpBrowserTarget } from './browser-cdp-access.ts'
import { RECORDING_EXPRESSION } from './cdp-instrument.ts'

class FakeDebugger extends EventEmitter {
  attached = false
  readonly commands: string[] = []
  readonly routed: Array<{ method: string; sessionId?: string }> = []
  attach(): void { this.attached = true }
  detach(): void { this.attached = false }
  isAttached(): boolean { return this.attached }
  async sendCommand(method: string, _params?: unknown, sessionId?: string): Promise<unknown> {
    this.commands.push(method)
    this.routed.push({ method, sessionId })
    return { source: method }
  }
}

class FakeContents extends EventEmitter {
  readonly debugger = new FakeDebugger()
  destroyed = false
  constructor(readonly id: number) { super() }
  isDestroyed(): boolean { return this.destroyed }
  async executeJavaScript(): Promise<unknown> { return undefined }
}

const tabs: BrowserTabInfo[] = [
  { id: 'tab-1', pos: 1, title: 'One', url: 'https://one.test', favicon: null, isLoading: false, active: true },
  { id: 'tab-2', pos: 2, title: 'Two', url: 'https://two.test', favicon: null, isLoading: false, active: false }
]

const cdpTabs: CdpBrowserTarget[] = tabs.map((tab) => ({ ...tab, kind: 'tab' as const }))

test('stale response body ids explain how to reacquire request ids', async () => {
  const contents = new FakeContents(1)
  contents.debugger.sendCommand = async (method, _params, sessionId) => {
    contents.debugger.commands.push(method)
    contents.debugger.routed.push({ method, sessionId })
    if (method === 'Network.getResponseBody') throw new Error('No resource with given identifier found')
    return { source: method }
  }
  const access = new BrowserCdpAccess(() => ({
    tabList: () => tabs,
    contentsOf: () => contents as unknown as WebContents,
    focusTabForInput: () => ({ activated: false })
  }))
  try {
    await assert.rejects(() => access.responseBody('tab-1', 'stale-9'), /no longer in CDP capture/)
  } finally {
    access.dispose()
  }
})

test('captured body reads route to the exact child session without fetching the URL', async () => {
  const contents = new FakeContents(1)
  const access = new BrowserCdpAccess(() => ({
    tabList: () => tabs,
    contentsOf: () => contents as unknown as WebContents,
    focusTabForInput: () => ({ activated: false })
  }))
  try {
    const result = await access.responseBody('tab-1', 'request-1', 'worker-1') as Record<string, unknown>
    assert.equal(result.sessionId, 'worker-1')
    assert.equal(result.requestId, 'request-1')
    assert.deepEqual(contents.debugger.routed.at(-1), { method: 'Network.getResponseBody', sessionId: 'worker-1' })
    assert.deepEqual(contents.debugger.commands, ['Target.setDiscoverTargets', 'Target.setAutoAttach', 'Network.getResponseBody'])
  } finally {
    access.dispose()
  }
})

test('CDP access resolves ClosedAI tab ids and reports target metadata', async () => {
  const contents = new Map([
    ['tab-1', new FakeContents(1)],
    ['tab-2', new FakeContents(2)]
  ])
  const browser: CdpBrowserSource = {
    tabList: () => tabs,
    contentsOf: (tabId) => contents.get(tabId ?? 'tab-1') as unknown as WebContents,
    focusTabForInput: () => ({ activated: false })
  }
  const access = new BrowserCdpAccess(() => browser)

  const capabilities = await access.capabilities() as Record<string, unknown>
  assert.deepEqual(capabilities.tab, cdpTabs[0])
  assert.deepEqual(contents.get('tab-1')?.debugger.commands, [
    'Target.setDiscoverTargets', 'Target.setAutoAttach', 'Browser.getVersion', 'Schema.getDomains'
  ])

  const targets = await access.targets('tab-2') as Record<string, unknown>
  assert.deepEqual(targets.tab, cdpTabs[1])
  assert.deepEqual(targets.inventory, [])
  assert.deepEqual(targets.roots, cdpTabs)
  assert.deepEqual(contents.get('tab-2')?.debugger.commands, [
    'Target.setDiscoverTargets', 'Target.setAutoAttach', 'Target.getTargetInfo', 'Target.getTargets'
  ])
  access.dispose()
})

test('CDP access rejects unknown tab ids before attaching', async () => {
  const browser: CdpBrowserSource = {
    tabList: () => tabs,
    contentsOf: () => null,
    focusTabForInput: () => ({ activated: false })
  }
  const access = new BrowserCdpAccess(() => browser)
  await assert.rejects(() => access.command('missing', 'DOM.getDocument', {}), /No tab with id missing/)
})

test('CDP access resolves a registered native popup without placing it in the tab strip', async () => {
  const popup: CdpBrowserTarget = {
    id: 'popup-9', pos: 0, title: 'OAuth', url: 'https://login.test', favicon: null,
    isLoading: false, active: false, kind: 'popup', openerTabId: 'tab-1'
  }
  const contents = new Map([
    ['tab-1', new FakeContents(1)],
    ['popup-9', new FakeContents(9)]
  ])
  const browser: CdpBrowserSource = {
    tabList: () => tabs,
    cdpTargetList: () => [...cdpTabs, popup],
    contentsOf: (tabId) => contents.get(tabId ?? 'tab-1') as unknown as WebContents,
    focusTabForInput: () => ({ activated: false })
  }
  const access = new BrowserCdpAccess(() => browser)
  const result = await access.command('popup-9', 'Runtime.evaluate', { expression: 'location.href' }) as Record<string, unknown>
  assert.deepEqual(result.tab, popup)
  assert.deepEqual(contents.get('popup-9')?.debugger.commands, [
    'Target.setDiscoverTargets', 'Target.setAutoAttach', 'Runtime.evaluate'
  ])
  access.dispose()
})

test('target inventory exposes registered roots without inserting popups into the tab strip', async () => {
  const popup: CdpBrowserTarget = {
    id: 'popup-10', pos: 0, title: 'Sign in', url: 'https://signin.test', favicon: null,
    isLoading: true, active: false, kind: 'popup', openerTabId: 'tab-2'
  }
  const contents = new Map([['tab-1', new FakeContents(1)]])
  const browser: CdpBrowserSource = {
    tabList: () => tabs,
    cdpTargetList: () => [...cdpTabs, popup],
    contentsOf: (tabId) => contents.get(tabId ?? 'tab-1') as unknown as WebContents,
    focusTabForInput: () => ({ activated: false })
  }
  const access = new BrowserCdpAccess(() => browser)
  const result = await access.targets() as Record<string, unknown>
  assert.deepEqual(result.roots, [...cdpTabs, popup])
  assert.equal((result.roots as CdpBrowserTarget[]).filter((target) => target.kind === 'popup').length, 1)
  assert.equal(tabs.some((tab) => tab.id === popup.id), false)
  access.dispose()
})

test('real input foregrounds a background tab and reports the switch', async () => {
  const contents = new Map([
    ['tab-1', new FakeContents(1)],
    ['tab-2', new FakeContents(2)]
  ])
  const focused: string[] = []
  const browser: CdpBrowserSource = {
    tabList: () => tabs,
    contentsOf: (tabId) => contents.get(tabId ?? 'tab-1') as unknown as WebContents,
    focusTabForInput: (tabId) => {
      focused.push(tabId)
      return { activated: tabId !== 'tab-1' }
    }
  }
  const access = new BrowserCdpAccess(() => browser)

  const background = await access.pressKey('tab-2', 'Enter', []) as Record<string, unknown>
  assert.deepEqual(focused, ['tab-2'])
  assert.equal(background.activatedTab, true)
  assert.ok(contents.get('tab-2')?.debugger.commands.includes('Input.dispatchKeyEvent'))

  const raw = await access.command('tab-2', 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a' }) as Record<string, unknown>
  assert.equal(raw.activatedTab, true)
  assert.deepEqual(focused, ['tab-2', 'tab-2'])

  // The already-active tab is left alone, so no needless tab switch is reported.
  const active = await access.pressKey('tab-1', 'Enter', []) as Record<string, unknown>
  assert.equal(active.activatedTab, undefined)
  access.dispose()
})

test('heap sampling is re-armed for every new document, which V8 does not do itself', async () => {
  const contents = new Map([['tab-1', new FakeContents(1)]])
  const browser: CdpBrowserSource = {
    tabList: () => tabs,
    contentsOf: (tabId) => contents.get(tabId ?? 'tab-1') as unknown as WebContents,
    focusTabForInput: () => ({ activated: false })
  }
  const access = new BrowserCdpAccess(() => browser)
  const target = contents.get('tab-1')!
  const armCount = (): number => target.debugger.commands.filter((c) => c === 'HeapProfiler.startSampling').length
  const navigate = async (frame: Record<string, unknown>): Promise<void> => {
    target.debugger.emit('message', {}, 'Page.frameNavigated', { frame })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  await access.profile('tab-1', 'start', { channels: ['heap'], limit: 5 })
  assert.equal(armCount(), 1)

  // A subframe commit keeps the tab's isolate, so it must not re-arm and discard the samples.
  await navigate({ id: 'child', parentId: 'root' })
  assert.equal(armCount(), 1)

  await navigate({ id: 'root' })
  assert.equal(armCount(), 2)

  const report = await access.profile('tab-1', 'stop', { channels: [], limit: 5 }) as Record<string, unknown>
  assert.ok(report.heap, 'stop folds the heap channel armed by start')
  assert.ok(target.debugger.commands.includes('HeapProfiler.stopSampling'))

  // The watch ends with the profiling run rather than re-arming a tab nobody is measuring.
  await navigate({ id: 'root' })
  assert.equal(armCount(), 2)
  access.dispose()
})

test('real input refuses when no tab can receive it, rather than silently doing nothing', async () => {
  const contents = new Map([['tab-1', new FakeContents(1)]])
  const browser: CdpBrowserSource = {
    tabList: () => tabs,
    contentsOf: (tabId) => contents.get(tabId ?? 'tab-1') as unknown as WebContents,
    focusTabForInput: () => null
  }
  const access = new BrowserCdpAccess(() => browser)
  await assert.rejects(() => access.clickElement('tab-1', 'p1:main:e1'), /not\s+on screen/)
  assert.ok(!contents.get('tab-1')?.debugger.commands.includes('Input.dispatchMouseEvent'))
  access.dispose()
})

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

test('network capture and the recorder reach cross-origin frames and workers, and unhook cleans every frame', async () => {
  const contents = new FakeContents(1)
  const routed = contents.debugger.routed
  contents.debugger.sendCommand = async (method: string, params?: unknown, sessionId?: string) => {
    contents.debugger.commands.push(method)
    routed.push({ method, sessionId })
    if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: `script-${sessionId ?? 'root'}` }
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: string })?.expression ?? '')
      if (expression === RECORDING_EXPRESSION) {
        return { result: { value: JSON.stringify({ installed: true, url: `https://${sessionId ?? 'root'}.test`, channels: ['fetch'], patches: [], counts: { fetch: sessionId ? 2 : 5 }, dropped: 0, events: [] }) } }
      }
      return { result: { value: sessionId ? 'installed' : '[]' } }
    }
    return {}
  }
  const access = new BrowserCdpAccess(() => ({
    tabList: () => tabs,
    contentsOf: () => contents as unknown as WebContents,
    focusTabForInput: () => ({ activated: false })
  }))
  try {
    const frame = { targetId: 'frame-1', type: 'iframe', title: '', url: 'https://ads.test/frame' }
    const worker = { targetId: 'worker-1', type: 'worker', title: '', url: 'https://one.test/w.js' }
    await access.capabilities('tab-1')
    contents.debugger.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'frame-s', targetInfo: frame, waitingForDebugger: false })
    contents.debugger.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'worker-s', targetInfo: worker, waitingForDebugger: false })
    await settle()

    const requests = await access.networkRequests('tab-1', { limit: 10 }) as { childSessions: { capturing: number; failed: unknown[] } }
    assert.deepEqual(requests.childSessions, { capturing: 2, failed: [] })
    assert.deepEqual(routed.filter((entry) => entry.method === 'Network.enable').map((entry) => entry.sessionId), [undefined, 'frame-s', 'worker-s'])

    const hooked = await access.instrument('tab-1', 'hook', { channels: ['fetch'], capacity: 100, limit: 5 }) as { frames: unknown[] }
    assert.deepEqual(hooked.frames, [{ sessionId: 'frame-s', url: 'https://ads.test/frame', onCurrentDocument: 'installed' }], 'the recorder is installed in the frame, not the worker')

    // A frame that appears after the hook starts paused, is instrumented, then resumes.
    contents.debugger.emit('message', {}, 'Target.attachedToTarget', {
      sessionId: 'late-s', targetInfo: { targetId: 'frame-2', type: 'iframe', title: '', url: 'https://late.test' }, waitingForDebugger: true
    })
    await settle()
    const late = routed.filter((entry) => entry.sessionId === 'late-s').map((entry) => entry.method)
    assert.ok(late.indexOf('Page.addScriptToEvaluateOnNewDocument') < late.indexOf('Runtime.runIfWaitingForDebugger'), late.join(','))
    assert.ok(!late.slice(0, late.indexOf('Runtime.runIfWaitingForDebugger')).includes('Runtime.evaluate'), 'a paused target has no current document to evaluate in')
    assert.ok(late.includes('Network.enable'), 'network capture also follows the late frame')
    contents.debugger.emit('message', {}, 'Target.targetInfoChanged', { targetInfo: { targetId: 'frame-2', type: 'iframe', title: '', url: 'https://late.test/loaded' } })

    const recording = await access.instrument('tab-1', 'recording', { channels: [], capacity: 100, limit: 5 }) as { counts: Record<string, number>; frames: Array<{ sessionId: string; url: string; counts: Record<string, number> }> }
    assert.deepEqual(recording.counts, { fetch: 5 })
    assert.deepEqual(recording.frames.map((entry) => [entry.sessionId, entry.counts]), [['frame-s', { fetch: 2 }], ['late-s', { fetch: 2 }]])
    assert.equal(recording.frames[1]?.url, 'https://late.test/loaded', 'frames report their current URL')

    const unhooked = await access.instrument('tab-1', 'unhook', { channels: [], capacity: 100, limit: 5 }) as { frames: Array<{ sessionId: string; error?: string }> }
    assert.deepEqual(unhooked.frames.map((entry) => [entry.sessionId, entry.error]), [['frame-s', undefined], ['late-s', undefined]])
    const removals = routed.filter((entry) => entry.method === 'Page.removeScriptToEvaluateOnNewDocument').map((entry) => entry.sessionId)
    assert.deepEqual(removals.sort(), [undefined, 'frame-s', 'late-s'].sort())
  } finally {
    access.dispose()
  }
})
