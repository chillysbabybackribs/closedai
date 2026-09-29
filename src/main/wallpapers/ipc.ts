import type { IpcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { registerInvoke } from '../ipc-register.js'
import type { WallpaperUploadStore } from './upload-store.js'

// Same shape as saved sites: the renderer names ids, the store owns the files.
export function registerWallpaperIpc(ipcMain: Pick<IpcMain, 'handle'>, store: () => WallpaperUploadStore): void {
  registerInvoke(ipcMain, IPC.invoke.wallpapers.list, () => store().list())
  registerInvoke(ipcMain, IPC.invoke.wallpapers.add, (_event, draft) => store().add(draft))
  registerInvoke(ipcMain, IPC.invoke.wallpapers.read, (_event, id) => store().read(id))
  registerInvoke(ipcMain, IPC.invoke.wallpapers.remove, (_event, id) => store().remove(id))
}
