import type { BrowserWindow } from 'electron'
import type { LoadURLOptions } from 'electron'
import { allSettledBounded } from './bounded-concurrency.js'
import type { BrowserTab } from './browser-tab.js'
import { restorePlan, type RestoredTabSession } from './browser-tab-session-store.js'

const RESTORE_LOAD_CONCURRENCY = 4

export type BrowserRestoreHost = {
  window: BrowserWindow
  tabs: (BrowserTab | import('./local-files/image-tab.js').ImageTab | import('./local-files/file-tab.js').FileTab)[]
  disposed: boolean
  createTab: (activate: boolean, index?: number, id?: string) => BrowserTab
  setActive: (id: string) => void
  emitError: (error: unknown) => void
  startTab: (tab: BrowserTab, url: string, options?: LoadURLOptions, stack?: Parameters<BrowserTab['start']>[2]) => Promise<void>
}

/** Rebuild the previous run's tab strip; returns false when there is nothing to restore. */
export function restoreBrowserTabs(host: BrowserRestoreHost, restored: RestoredTabSession): boolean {
  if (restored.tabs.length === 0) return false
  const plan = restorePlan(restored.tabs.length, restored.activeIndex)
  const seen = new Set<string>()
  const tabs = restored.tabs.map((record) => {
    const id = record.id && !seen.has(record.id) ? record.id : undefined
    if (id) seen.add(id)
    const tab = host.createTab(false, undefined, id)
    tab.seedRestoredState(record.url, record.title, record.customTitle)
    return { tab, record }
  })
  host.setActive(tabs[plan.activeIndex].tab.id)
  void allSettledBounded(plan.loadOrder.map((index) => tabs[index]), RESTORE_LOAD_CONCURRENCY, async ({ tab, record }) => {
    if (!host.tabs.includes(tab)) return
    await host.startTab(tab, record.url, undefined, record.stack)
  }).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') host.emitError(result.reason)
    }
  })
  return true
}
