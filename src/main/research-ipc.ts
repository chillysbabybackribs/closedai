import type { IpcMain } from 'electron'
import { IPC } from '../shared/ipc-channels.js'
import { registerInvoke } from './ipc-register.js'
import type { ResearchService } from './tools/search/research/service.js'

/** Excerpt page for the user's own reading; the model-facing source action has its own cap. */
const EXCERPT_CHARS = 4000

export function registerResearchIpc(ipcMain: Pick<IpcMain, 'handle'>, getService: () => ResearchService | null): void {
  const service = () => {
    const instance = getService()
    if (!instance) throw new Error('Research is not ready')
    return instance
  }
  registerInvoke(ipcMain, IPC.invoke.research.activity, (_event, paneId) => service().activity(paneId))
  registerInvoke(ipcMain, IPC.invoke.research.cancel, (_event, runId) => { service().cancelRun(runId) })
  registerInvoke(ipcMain, IPC.invoke.research.excerpt, (_event, runId, sourceId, offset) =>
    service().excerpt(runId, sourceId, offset ?? 0, EXCERPT_CHARS))
}
