import type { IpcMain } from 'electron'

import { IPC } from '../shared/ipc-channels.js'
import type { ProjectHub } from './project-store/project-hub.js'

export function registerProjectIpc(ipcMain: IpcMain, hub: () => ProjectHub | null): void {
  ipcMain.handle(IPC.invoke.project.snapshot, async (_event, projectPath: string) => {
    const service = hub()
    if (!service) throw new Error('Project service is not ready')
    return service.snapshot(projectPath)
  })
}
