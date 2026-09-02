import type { IpcMain } from 'electron'
import type { RunStatus } from '../shared/operations.js'
import type { OperationsService } from './operations-service.js'

export function registerOperationsIpc(ipcMain: IpcMain, getService: () => OperationsService | null): void {
  const requireService = (): OperationsService => {
    const service = getService()
    if (!service) throw new Error('Operations service is not available')
    return service
  }

  ipcMain.handle('operations:snapshot', () => requireService().snapshot())
  ipcMain.handle('operations:models', () => requireService().models())
  ipcMain.handle('operations:create', (_event, task: string, workspace: string, modelId: string) => {
    if (typeof task !== 'string' || typeof workspace !== 'string' || typeof modelId !== 'string') {
      throw new Error('Invalid worker input')
    }
    return requireService().create(task, workspace, modelId)
  })
  ipcMain.handle('operations:setStatus', (_event, id: number, status: RunStatus) => {
    if (typeof id !== 'number' || typeof status !== 'string') throw new Error('Invalid run status input')
    return requireService().setStatus(id, status)
  })
}
