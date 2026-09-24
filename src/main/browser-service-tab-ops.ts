import type { BrowserWindow } from 'electron'
import type { BrowserBounds, BrowserState } from '../shared/types.js'
import { activateTabSurface } from './browser-tab-activation.js'
import { BrowserTab } from './browser-tab.js'
import { browserSurfaceVisibility } from './browser-surface-visibility.js'
import { ImageTab } from './local-files/image-tab.js'
import { FileTab } from './local-files/file-tab.js'
import type { TabRenderingPolicy } from './browser-tab-rendering.js'
import type { TabCadencePolicy } from './browser-tab-cadence.js'
import { settleFrames, TAB_SWITCH_SETTLE_MS } from './browser-frame-settle.js'

export type BrowserServiceTabOpsHost = {
  window: BrowserWindow
  tabs: (BrowserTab | ImageTab | FileTab)[]
  getActiveId: () => string | null
  setActiveId: (id: string | null) => void
  bounds: BrowserBounds
  rendering: TabRenderingPolicy
  cadence: TabCadencePolicy
  openHomeTab: () => void
  attachTabView: (tabId: string) => void
  emitTabState: (state: BrowserState) => void
  emitTabs: () => void
  unregisterRendering: (id: string) => void
  forgetCadence: (id: string) => void
  detachBrowserView: (tab: BrowserTab | ImageTab | FileTab) => void
}

export function parkWebBrowserTabs(host: BrowserServiceTabOpsHost): void {
  const bounds = { ...host.bounds, occluded: true }
  for (const tab of host.tabs) {
    if (tab instanceof BrowserTab) tab.applyBounds(bounds, false)
  }
}

export function setBrowserActiveTab(host: BrowserServiceTabOpsHost, id: string): void {
  const next = host.tabs.find((tab) => tab.id === id)
  if (!next) return
  const activeId = host.getActiveId()
  if (next instanceof ImageTab || next instanceof FileTab) {
    if (activeId !== id) next.previousTabId = activeId
    host.setActiveId(id)
    parkWebBrowserTabs(host)
    host.rendering.setActive(null)
    host.emitTabState(next.getState())
    host.emitTabs()
    return
  }
  const visibility = browserSurfaceVisibility(host.bounds)
  host.setActiveId(id)
  activateTabSurface(
    host.tabs.filter((tab): tab is BrowserTab => tab instanceof BrowserTab),
    next,
    host.bounds,
    visibility,
    () => host.rendering.setActive(id),
    () => host.attachTabView(next.id)
  )
  host.cadence.handoff(next.id)
  if (visibility.paneVisible && visibility.pageVisible) {
    void settleFrames(next.view.webContents, TAB_SWITCH_SETTLE_MS).catch(() => {})
  }
  host.emitTabState(next.getState())
  host.emitTabs()
}

export function closeBrowserTab(host: BrowserServiceTabOpsHost, id: string): void {
  const index = host.tabs.findIndex((tab) => tab.id === id)
  if (index === -1) return
  const [tab] = host.tabs.splice(index, 1)
  host.unregisterRendering(id)
  host.forgetCadence(id)
  host.detachBrowserView(tab)
  tab.dispose()
  if (host.getActiveId() === id) {
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

export function closeBrowserTabsToRight(host: BrowserServiceTabOpsHost, id: string): void {
  const index = host.tabs.findIndex((tab) => tab.id === id)
  if (index === -1) return
  const closing = host.tabs.slice(index + 1).map((tab) => tab.id)
  for (const tabId of closing) closeBrowserTab(host, tabId)
}
