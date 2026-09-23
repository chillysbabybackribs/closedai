import type { IpcMain } from 'electron'
import type { AgentRunStartOptions } from '../../shared/agent-runs.js'
import { IPC } from '../../shared/ipc-channels.js'
import type { AgentRunService } from './agent-run-service.js'

export function registerAgentRunsIpc(ipcMain: IpcMain, getService: () => AgentRunService | null): void {
  const requireService = (): AgentRunService => {
    const service = getService()
    if (!service) throw new Error('Agent runs are not available')
    return service
  }
  ipcMain.handle(IPC.invoke.agentRuns.list, () => requireService().runs())
  ipcMain.handle(IPC.invoke.agentRuns.start, (_event, chatId: string, options: AgentRunStartOptions) =>
    requireService().startRun(chatId, options))
  ipcMain.handle(IPC.invoke.agentRuns.pause, (_event, chatId: string) =>
    requireService().pauseRun(chatId, 'Paused by you', { interrupt: true }))
  ipcMain.handle(IPC.invoke.agentRuns.resume, (_event, chatId: string) => requireService().resumeRun(chatId))
  ipcMain.handle(IPC.invoke.agentRuns.stop, (_event, chatId: string) => requireService().stopRun(chatId))
}
