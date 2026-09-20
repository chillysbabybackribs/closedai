import type { BrowserWindow, IpcMain } from 'electron'
import { IPC } from '../shared/ipc-channels.js'
import { registerInvoke } from './ipc-register.js'

export function registerWindowIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  getMainWindow: () => BrowserWindow | null
): void {
  registerInvoke(ipcMain, IPC.invoke.window.minimize, () => {
    getMainWindow()?.minimize()
  })
  registerInvoke(ipcMain, IPC.invoke.window.maximize, () => {
    const window = getMainWindow()
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  registerInvoke(ipcMain, IPC.invoke.window.toggleFullscreen, () => {
    const window = getMainWindow()
    if (!window) return
    window.setFullScreen(!window.isFullScreen())
  })
  registerInvoke(ipcMain, IPC.invoke.window.close, () => {
    getMainWindow()?.close()
  })
}
