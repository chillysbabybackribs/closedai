import type { IpcMain } from 'electron'

import { IPC } from '../shared/ipc-channels.js'
import type { ChatWorkspaceSurface } from './chat-peers/peer-workspace.js'
import type { ProjectHub } from './project-store/project-hub.js'

export function registerProjectIpc(
  ipcMain: IpcMain,
  hub: () => ProjectHub | null,
  chat: () => ChatWorkspaceSurface | null
): void {
  ipcMain.handle(IPC.invoke.project.snapshot, async (_event, projectPath: string) => {
    const service = hub()
    if (!service) throw new Error('Project service is not ready')
    return service.snapshot(projectPath)
  })
  ipcMain.handle(IPC.invoke.project.ensurePeers, (_event, projectPath: string, modelId: string | null, reasoningEffort: string | null) => {
    const service = chat()
    if (!service) throw new Error('Chat service is not available')
    return service.ensureProjectPeers(projectPath, modelId, reasoningEffort)
  })
}
