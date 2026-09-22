import type { BrowserWindow } from 'electron'
import type { BrowserBounds, BrowserState } from '../shared/types.js'
import { activateTabSurface } from './browser-tab-activation.js'
import { BrowserTab, HOME_URL } from './browser-tab.js'
import { browserSurfaceVisibility } from './browser-surface-visibility.js'
import { ImageTab } from './local-files/image-tab.js'
import { FileTab } from './local-files/file-tab.js'
import type { TabRenderingPolicy } from './browser-tab-rendering.js'
import type { TabCadencePolicy } from './browser-tab-cadence.js'

export type BrowserServiceTabOpsHost = {
  window: BrowserWindow
  tabs: (BrowserTab | ImageTab | FileTab)[]
  activeId: string | null
  setActiveId: (id: string | null) => void
  bounds: BrowserBounds
  rendering: TabRenderingPolicy
  cadence: TabCadencePolicy
  openHomeTab: () => void
  attachTabView: (tabId: string) => void
  emitState: (state: BrowserState) => void
  emitTabs: () => void
  unregisterTab: (id: string) => void
  disposeTab: (tab: BrowserTab | ImageTab | FileTab) => void
  detachTabView: (tabId: string) => void
}

export function parkWebBrowserTabs(host: BrowserServiceTabOpsHost): void {
  const bounds = { ...host.bounds, x: host.window.getContentBounds().width, occluded: true }
  for (const tab of host.tabs) {
    if (tab instanceof BrowserTab) tab.applyBounds(bounds, false)
  }
}

export function setBrowserActiveTab(host: BrowserServiceTabOpsHost, id: string): void {
  const next = host.tabs.find((tab) => tab.id === id)
  if (!next) return
  if (next instanceof ImageTab || next instanceof FileTab) {
    if (host.activeId !== id) next.previousTabId = host.activeId
    host.setActiveId(id)
    parkWebBrowserTabs(host)
    host.rendering.setActive(null)
    host.emitState(next.getState())
    host.emitTabs()
    return
  }
  host.setActiveId(id)
  activateTabSurface(
    host.tabs.filter((tab): tab is BrowserTab => tab instanceof BrowserTab),
    next,
    host.bounds,
    browserSurfaceVisibility(host.bounds),
    () => host.rendering.setActive(id),
    () => host.attachTabView(next.id)
  )
  host.cadence.handoff(next.id)
  host.emitState(next.getState())
  host.emitTabs()
}

export function closeBrowserTab(host: BrowserServiceTabOpsHost, id: string): void {
  const index = host.tabs.findIndex((tab) => tab.id === id)
  if (index === -1) return
  const [tab] = host.tabs.splice(index, 1)
  host.unregisterTab(id)
  host.detachTabView(id)
  host.disposeTab(tab)
  if (host.activeId === id) {
    host.setActiveId(null)
    const previous = (tab instanceof ImageTab || tab instanceof FileTab)
      ? host.tabs.find((item) => item.id === tab.previousTabId) : null
    const next = previous ?? host.tabs[index] ?? host.tabs[index - 1] ?? null
    if (next) setBrowserActiveTab(host, next.id)
    else host.openHomeTab()
  } else {
    host.emitTabs()
  }
}

export function closeOtherBrowserTabs(host: BrowserServiceTabOpsHost, id: string): void {
  if (!host.tabs.some((tab) => tab.id === id)) return
  const closing = host.tabs.filter((tab) => tab.id !== id).map((tab) => tab.id)
  for (const tabId of closing) closeBrowserTab(host, tabId)
  setBrowserActiveTab(host, id)
}

export function closeTabsToRight(host: BrowserServiceTabOpsHost, id: string): void {
  const index = host.tabs.findIndex((tab) => tab.id === id)
  if (index === -1) return
  const closing = host.tabs.slice(index + 1).map((tab) => tab.id)
  for (const tabId of closing) closeBrowserTab(host, tabId)
}
