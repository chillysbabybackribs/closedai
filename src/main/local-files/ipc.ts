import { shell, type IpcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { registerInvoke } from '../ipc-register.js'
import { openLocalFile } from './open.js'

export function registerLocalFilesIpc(ipcMain: Pick<IpcMain, 'handle'>): void {
  registerInvoke(ipcMain, IPC.invoke.localFiles.open, (_event, href) =>
    openLocalFile(href, (path) => shell.showItemInFolder(path)))
}
