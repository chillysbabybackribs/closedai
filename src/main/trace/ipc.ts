import type { IpcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import type { TraceLog } from './trace-log.js'

export function registerTraceIpc(ipcMain: IpcMain, log: TraceLog): void {
  ipcMain.handle(IPC.invoke.trace.setActive, (_, active: boolean) => { log.setActive(active) })
  ipcMain.handle(IPC.invoke.trace.snapshot, () => log.snapshot())
  ipcMain.handle(IPC.invoke.trace.clear, () => { log.clear() })
}
