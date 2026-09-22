import type { IpcMain } from 'electron'

import { IPC } from '../shared/ipc-channels.js'
import type { ProjectMutation } from '../shared/project/mutations.js'
import type { ProjectHub } from './project-store/project-hub.js'

export function registerProjectIpc(ipcMain: Pick<IpcMain, 'handle'>, hub: () => ProjectHub | null): void {
  const ready = (): ProjectHub => {
    const service = hub()
    if (!service) throw new Error('Project service is not ready')
    return service
  }
  ipcMain.handle(IPC.invoke.project.snapshot, async (_event, projectPath: string) => ready().snapshot(projectPath))
  ipcMain.handle(IPC.invoke.project.mutate, async (_event, projectPath: string, mutations: ProjectMutation[]) =>
    ready().mutate(projectPath, Array.isArray(mutations) ? mutations : []))
}
