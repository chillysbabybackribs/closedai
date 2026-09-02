import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { WebContents } from 'electron'
import type { BrowserTabInfo } from '../../shared/types.ts'
import { BrowserCdpAccess, type CdpBrowserSource } from './browser-cdp-access.ts'

class FakeDebugger extends EventEmitter {
  attached = false
  readonly commands: string[] = []
  attach(): void { this.attached = true }
  detach(): void { this.attached = false }
  isAttached(): boolean { return this.attached }
  async sendCommand(method: string): Promise<unknown> {
    this.commands.push(method)
    return { source: method }
  }
}

class FakeContents extends EventEmitter {
  readonly debugger = new FakeDebugger()
  destroyed = false
  constructor(readonly id: number) { super() }
  isDestroyed(): boolean { return this.destroyed }
}

const tabs: BrowserTabInfo[] = [
  { id: 'tab-1', pos: 1, title: 'One', url: 'https://one.test', favicon: null, isLoading: false, active: true },
  { id: 'tab-2', pos: 2, title: 'Two', url: 'https://two.test', favicon: null, isLoading: false, active: false }
]

test('CDP access resolves ClosedAI tab ids and reports target metadata', async () => {
  const contents = new Map([
    ['tab-1', new FakeContents(1)],
    ['tab-2', new FakeContents(2)]
  ])
  const browser: CdpBrowserSource = {
    tabList: () => tabs,
    contentsOf: (tabId) => contents.get(tabId ?? 'tab-1') as unknown as WebContents
  }
  const access = new BrowserCdpAccess(() => browser)

  const capabilities = await access.capabilities() as Record<string, unknown>
  assert.deepEqual(capabilities.tab, tabs[0])
  assert.deepEqual(contents.get('tab-1')?.debugger.commands, ['Browser.getVersion', 'Schema.getDomains'])

  const targets = await access.targets('tab-2') as Record<string, unknown>
  assert.deepEqual(targets.tab, tabs[1])
  assert.deepEqual(contents.get('tab-2')?.debugger.commands, ['Target.getTargetInfo', 'Target.getTargets'])
  access.dispose()
})

test('CDP access rejects unknown tab ids before attaching', async () => {
  const browser: CdpBrowserSource = { tabList: () => tabs, contentsOf: () => null }
  const access = new BrowserCdpAccess(() => browser)
  await assert.rejects(() => access.command('missing', 'DOM.getDocument', {}), /does not exist/)
})
