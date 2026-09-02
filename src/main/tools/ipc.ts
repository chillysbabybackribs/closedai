import type { IpcMain } from 'electron'
import { toolManifest } from './manifest.js'
import type { ToolRegistry } from './registry.js'
import type { ToolTelemetry } from './telemetry.js'

export type ToolsIpcDeps = {
  registry: () => ToolRegistry | null
  telemetry: () => ToolTelemetry | null
  /** Providers the registry is advertised to right now (for the modal header). */
  providers: () => string[]
  /** Persist the disabled ids and tell the renderer. */
  onEnabledChanged: (toolId: string, enabled: boolean, disabledIds: string[]) => Promise<void>
}

export function registerToolsIpc(ipcMain: IpcMain, deps: ToolsIpcDeps): void {
  ipcMain.handle('tools:manifest', () => {
    const registry = deps.registry()
    if (!registry) throw new Error('Tools are not available')
    return toolManifest(registry, deps.providers())
  })
  ipcMain.handle('tools:telemetry', () => {
    const telemetry = deps.telemetry()
    if (!telemetry) throw new Error('Tool telemetry is not available')
    return telemetry.snapshot()
  })
  ipcMain.handle('tools:clearTelemetry', async () => {
    await deps.telemetry()?.clear()
  })
  ipcMain.handle('tools:setEnabled', async (_event, toolId: string, enabled: boolean) => {
    const registry = deps.registry()
    if (!registry) throw new Error('Tools are not available')
    if (typeof toolId !== 'string' || typeof enabled !== 'boolean') throw new Error('Invalid tool toggle')
    const disabledIds = registry.setEnabled(toolId, enabled)
    await deps.onEnabledChanged(toolId, enabled, disabledIds)
  })
}
