import type { IpcMain, WebContents } from 'electron'
import type { BrowserBounds, VideoCompareCommand } from '../shared/types.js'
import { IPC } from '../shared/ipc-channels.js'
import type { BrowserService } from './browser-service.js'
import { rankSavedFirst, type SavedSitesStore } from './saved-sites-store.js'

/** The renderer-facing browser surface. */
export function registerBrowserCoreIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  getBrowserService: () => BrowserService | null,
  getSavedSites: () => SavedSitesStore | null = () => null,
  // The page is laid out in the main window; a detached window's renderer must never move it.
  isBrowserHost: (sender: WebContents) => boolean = () => true
): void {
  ipcMain.handle(IPC.invoke.browser.setBounds, (event, bounds: BrowserBounds) =>
    isBrowserHost(event.sender) ? getBrowserService()?.setBounds(bounds) : undefined)
  ipcMain.handle(IPC.invoke.browser.navigate, (_event, input: string) => getBrowserService()?.navigate(input))
  ipcMain.handle(IPC.invoke.browser.back, () => getBrowserService()?.back())
  ipcMain.handle(IPC.invoke.browser.forward, () => getBrowserService()?.forward())
  ipcMain.handle(IPC.invoke.browser.reload, () => getBrowserService()?.reload())
  // Saved sites lead the suggestion list: a page the user kept on purpose outranks one merely visited often.
  ipcMain.handle(IPC.invoke.browser.searchHistory, (_event, input: string) =>
    rankSavedFirst(getSavedSites()?.search(input) ?? [], getBrowserService()?.searchHistory(input) ?? []))
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
  ipcMain.handle(IPC.invoke.browser.openVideoHub, () => {
    const service = getBrowserService()
    if (!service) throw new Error('The browser pane is not available.')
    return service.openVideoHub()
  })
  ipcMain.handle(IPC.invoke.browser.videoCompare, (_event, command: VideoCompareCommand) => {
    const service = getBrowserService()
    if (!service) return
    if (command.op === 'start') service.startVideoCompare(command.otherTabId)
    else if (command.op === 'clear') service.clearVideoCompare()
    else if (command.op === 'sync') service.setVideoCompareSync(command.enabled)
    else service.setVideoCompareAudio(command.tabId)
  })
}
