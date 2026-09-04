import type { IpcMain } from 'electron'
import type { TraceLog } from './trace-log.js'

export function registerTraceIpc(ipcMain: IpcMain, log: TraceLog): void {
  ipcMain.handle('trace:setActive', (_, active: boolean) => { log.setActive(active) })
  ipcMain.handle('trace:snapshot', () => log.snapshot())
  ipcMain.handle('trace:clear', () => { log.clear() })
}
