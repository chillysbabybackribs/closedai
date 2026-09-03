import type { IpcMain } from 'electron'
import type { BrowserBounds } from '../shared/types.js'
import type { BrowserService } from './browser-service.js'

/** The renderer-facing browser surface. */
export function registerBrowserCoreIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  getBrowserService: () => BrowserService | null
): void {
  ipcMain.handle('browser:setBounds', (_event, bounds: BrowserBounds) => getBrowserService()?.setBounds(bounds))
  ipcMain.handle('browser:navigate', (_event, input: string) => getBrowserService()?.navigate(input))
  ipcMain.handle('browser:back', () => getBrowserService()?.back())
  ipcMain.handle('browser:forward', () => getBrowserService()?.forward())
  ipcMain.handle('browser:reload', () => getBrowserService()?.reload())
  ipcMain.handle('browser:searchHistory', (_event, input: string) => getBrowserService()?.searchHistory(input) ?? [])
  ipcMain.handle('browser:removeHistory', (_event, url: string) => getBrowserService()?.removeHistory(url))
  ipcMain.handle('browser:suggest', (_event, input: string) => getBrowserService()?.suggest(input) ?? null)
  ipcMain.handle('browser:newTab', () => getBrowserService()?.newTab())
  ipcMain.handle('browser:openTab', (_event, input: string) => getBrowserService()?.openNewTab(input))
  ipcMain.handle('browser:closeTab', (_event, id: string) => getBrowserService()?.closeTab(id))
  ipcMain.handle('browser:selectTab', (_event, id: string) => getBrowserService()?.selectTab(id))
  ipcMain.handle('browser:capture', () => getBrowserService()?.capture() ?? null)
  ipcMain.handle('browser:snapshot', () => getBrowserService()?.browserSnapshot() ?? null)
}
