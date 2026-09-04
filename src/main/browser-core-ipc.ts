import type { IpcMain } from 'electron'
import type { BrowserBounds } from '../shared/types.js'
import { IPC } from '../shared/ipc-channels.js'
import type { BrowserService } from './browser-service.js'

/** The renderer-facing browser surface. */
export function registerBrowserCoreIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  getBrowserService: () => BrowserService | null
): void {
  ipcMain.handle(IPC.invoke.browser.setBounds, (_event, bounds: BrowserBounds) => getBrowserService()?.setBounds(bounds))
  ipcMain.handle(IPC.invoke.browser.navigate, (_event, input: string) => getBrowserService()?.navigate(input))
  ipcMain.handle(IPC.invoke.browser.back, () => getBrowserService()?.back())
  ipcMain.handle(IPC.invoke.browser.forward, () => getBrowserService()?.forward())
  ipcMain.handle(IPC.invoke.browser.reload, () => getBrowserService()?.reload())
  ipcMain.handle(IPC.invoke.browser.searchHistory, (_event, input: string) => getBrowserService()?.searchHistory(input) ?? [])
  ipcMain.handle(IPC.invoke.browser.removeHistory, (_event, url: string) => getBrowserService()?.removeHistory(url))
  ipcMain.handle(IPC.invoke.browser.suggest, (_event, input: string) => getBrowserService()?.suggest(input) ?? null)
  ipcMain.handle(IPC.invoke.browser.newTab, () => getBrowserService()?.newTab())
  ipcMain.handle(IPC.invoke.browser.newTabToRight, (_event, id: string) => getBrowserService()?.newTabToRight(id))
  ipcMain.handle(IPC.invoke.browser.openTab, (_event, input: string) => getBrowserService()?.openNewTab(input))
  ipcMain.handle(IPC.invoke.browser.closeTab, (_event, id: string) => getBrowserService()?.closeTab(id))
  ipcMain.handle(IPC.invoke.browser.closeOtherTabs, (_event, id: string) => getBrowserService()?.closeOtherTabs(id))
  ipcMain.handle(IPC.invoke.browser.closeTabsToRight, (_event, id: string) => getBrowserService()?.closeTabsToRight(id))
  ipcMain.handle(IPC.invoke.browser.duplicateTab, (_event, id: string) => getBrowserService()?.duplicateTab(id))
  ipcMain.handle(IPC.invoke.browser.reloadTab, (_event, id: string) => getBrowserService()?.reloadTab(id))
  ipcMain.handle(IPC.invoke.browser.renameTab, (_event, id: string, title: string | null) => getBrowserService()?.renameTab(id, title))
  ipcMain.handle(IPC.invoke.browser.selectTab, (_event, id: string) => getBrowserService()?.selectTab(id))
  ipcMain.handle(IPC.invoke.browser.capture, () => getBrowserService()?.capture() ?? null)
  ipcMain.handle(IPC.invoke.browser.snapshot, () => getBrowserService()?.browserSnapshot() ?? null)
}
