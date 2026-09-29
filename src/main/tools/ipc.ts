import type { IpcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import type { ToolsEvent } from '../../shared/tools.js'
import type { ToolSwitch } from '../../shared/tools.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import { toolManifest } from './manifest.js'
import type { ToolRegistry } from './registry.js'
import type { ToolTelemetry } from './telemetry.js'

export type ToolsIpcDeps = {
  registry: () => ToolRegistry | null
  telemetry: () => ToolTelemetry | null
  settings: () => AppSettingsAccess | null
  /** Providers the registry is advertised to right now (for the modal header). */
  providers: () => string[]
  notifyEvent: (event: ToolsEvent) => void
  /** Persist the disabled ids and tell the renderer. */
  onEnabledChanged: (toolId: string, enabled: boolean, disabledIds: string[]) => Promise<void>
  /** Persist after a bulk change; the renderer refreshes the manifest itself. */
  onEnabledManyChanged: (disabledIds: string[]) => Promise<void>
}

export function registerToolsIpc(ipcMain: IpcMain, deps: ToolsIpcDeps): void {
  ipcMain.handle(IPC.invoke.tools.manifest, () => {
    const registry = deps.registry()
    if (!registry) throw new Error('Tools are not available')
    const manifest = toolManifest(registry, deps.providers())
    return { ...manifest, chatToolSliceEnabled: deps.settings()?.get().chatToolSliceEnabled === true }
  })
  ipcMain.handle(IPC.invoke.tools.telemetry, () => {
    const telemetry = deps.telemetry()
    if (!telemetry) throw new Error('Tool telemetry is not available')
    return telemetry.snapshot()
  })
  ipcMain.handle(IPC.invoke.tools.clearTelemetry, async () => {
    await deps.telemetry()?.clear()
  })
  ipcMain.handle(IPC.invoke.tools.setEnabled, async (_event, toolId: string, enabled: boolean) => {
    const registry = deps.registry()
    if (!registry) throw new Error('Tools are not available')
    if (typeof toolId !== 'string' || typeof enabled !== 'boolean') throw new Error('Invalid tool toggle')
    const disabledIds = registry.setEnabled(toolId, enabled)
    await deps.onEnabledChanged(toolId, enabled, disabledIds)
  })
  ipcMain.handle(IPC.invoke.tools.setEnabledMany, async (_event, switches: unknown) => {
    const registry = deps.registry()
    if (!registry) throw new Error('Tools are not available')
    if (!Array.isArray(switches) || !switches.every((entry) =>
      entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.enabled === 'boolean')) {
      throw new Error('Invalid tool switches')
    }
    await deps.onEnabledManyChanged(registry.setEnabledMany(switches as ToolSwitch[]))
  })
  ipcMain.handle(IPC.invoke.tools.setChatToolSliceEnabled, async (_event, enabled: unknown) => {
    const settings = deps.settings()
    if (!settings) throw new Error('Settings are not available')
    if (typeof enabled !== 'boolean') throw new Error('Invalid tool slice toggle')
    await settings.set({ chatToolSliceEnabled: enabled })
    deps.notifyEvent({ type: 'changed' })
  })
}
