import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC } from '../shared/ipc-channels.js'
import { registerInvoke } from './ipc-register.js'

// Title-bar controls act on the window whose renderer pressed them, main or detached.
export function registerWindowIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  windowOf: (event: IpcMainInvokeEvent) => BrowserWindow | null
): void {
  registerInvoke(ipcMain, IPC.invoke.window.minimize, (event) => {
    windowOf(event)?.minimize()
  })
  registerInvoke(ipcMain, IPC.invoke.window.maximize, (event) => {
    const window = windowOf(event)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  registerInvoke(ipcMain, IPC.invoke.window.toggleFullscreen, (event) => {
    const window = windowOf(event)
    if (!window) return
    window.setFullScreen(!window.isFullScreen())
  })
  registerInvoke(ipcMain, IPC.invoke.window.close, (event) => {
    windowOf(event)?.close()
  })
  registerInvoke(ipcMain, IPC.invoke.window.toggleDevTools, (event) => {
    const contents = windowOf(event)?.webContents
    if (!contents) return
    if (contents.isDevToolsOpened()) contents.closeDevTools()
    else contents.openDevTools({ mode: 'detach' })
  })
}
