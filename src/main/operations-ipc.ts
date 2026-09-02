import type { IpcMain } from 'electron'
import type { RunStatus, ScheduleFrequency } from '../shared/operations.js'
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
  ipcMain.handle('operations:createSchedule', (_event, name: string, task: string, workspace: string, modelId: string, frequency: ScheduleFrequency) => {
    if ([name, task, workspace, modelId, frequency].some((value) => typeof value !== 'string')) throw new Error('Invalid schedule input')
    return requireService().createSchedule(name, task, workspace, modelId, frequency)
  })
  ipcMain.handle('operations:setScheduleEnabled', (_event, id: number, enabled: boolean) => {
    if (typeof id !== 'number' || typeof enabled !== 'boolean') throw new Error('Invalid schedule status input')
    return requireService().setScheduleEnabled(id, enabled)
  })
  ipcMain.handle('operations:runScheduleNow', (_event, id: number) => {
    if (typeof id !== 'number') throw new Error('Invalid schedule input')
    return requireService().runScheduleNow(id)
  })
  ipcMain.handle('operations:deleteSchedule', (_event, id: number) => {
    if (typeof id !== 'number') throw new Error('Invalid schedule input')
    return requireService().deleteSchedule(id)
  })
}
