import type { IpcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { registerInvoke } from '../ipc-register.js'
import type { ResearchLibrary } from './service.js'

export function registerResearchLibraryIpc(ipcMain: Pick<IpcMain, 'handle'>, getLibrary: () => ResearchLibrary | null): void {
  const library = () => {
    const instance = getLibrary()
    if (!instance) throw new Error('Research library is not ready')
    return instance
  }
  registerInvoke(ipcMain, IPC.invoke.researchLibrary.snapshot, () => library().snapshot())
  registerInvoke(ipcMain, IPC.invoke.researchLibrary.configure, (_event, settings) => library().configure(settings))
  registerInvoke(ipcMain, IPC.invoke.researchLibrary.refresh, () => library().refresh())
  registerInvoke(ipcMain, IPC.invoke.researchLibrary.cancel, () => library().cancel())
  registerInvoke(ipcMain, IPC.invoke.researchLibrary.dismiss, (_event, id) => library().dismiss(id))
  registerInvoke(ipcMain, IPC.invoke.researchLibrary.restore, () => library().restore())
}
