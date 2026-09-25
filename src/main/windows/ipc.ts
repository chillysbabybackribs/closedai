import type { IpcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { registerInvoke } from '../ipc-register.js'
import type { AppWindowRegistry } from './app-window-registry.js'
import { captureWindowRegion } from './window-capture.js'

export function registerAppWindowsIpc(ipcMain: Pick<IpcMain, 'handle'>, registry: () => AppWindowRegistry | null): void {
  const require = (): AppWindowRegistry => {
    const windows = registry()
    if (!windows) throw new Error('Windows are not available yet')
    return windows
  }
  registerInvoke(ipcMain, IPC.invoke.windows.context, (event) => require().context(event.sender))
  registerInvoke(ipcMain, IPC.invoke.windows.list, () => require().list())
  registerInvoke(ipcMain, IPC.invoke.windows.detachTabs, (event, cwd, tabIds) => require().detach(event.sender, cwd, tabIds))
  registerInvoke(ipcMain, IPC.invoke.windows.returnTabs, (event, tabIds) => require().returnTabs(event.sender, tabIds))
  registerInvoke(ipcMain, IPC.invoke.windows.revealTab, (event, tabId) => require().revealTab(event.sender, tabId))
  registerInvoke(ipcMain, IPC.invoke.windows.showBrowser, () => require().showBrowser())
  registerInvoke(ipcMain, IPC.invoke.windows.capture, (event, region) => captureWindowRegion(event.sender, region))
}
