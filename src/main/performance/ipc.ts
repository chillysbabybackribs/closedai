import type { IpcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels.js'
import { normalizePerformanceSettings, type PerformanceSettings, type ResponsePaint } from '../../shared/performance.js'
import type { AppSettingsAccess } from '../app-settings-store.js'
import type { ResponseLatency } from '../trace/response-latency.js'

export function registerPerformanceIpc(ipc: IpcMain, deps: {
  settings: () => AppSettingsAccess | null
  responses: ResponseLatency
  changed: (settings: PerformanceSettings) => void
}): void {
  ipc.handle(IPC.invoke.performance.settings, () => deps.settings()?.get().performance ?? normalizePerformanceSettings(null))
  ipc.handle(IPC.invoke.performance.update, async (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid performance settings')
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'instantStreaming' || key === 'autoTitles') {
        if (typeof value !== 'boolean') throw new Error('Invalid performance toggle')
      } else if (key === 'warmMinutes' || key === 'warmIdleChats') {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid warm-time value')
      } else throw new Error('Unknown performance setting')
    }
    const store = deps.settings()
    if (!store) throw new Error('Settings are not available')
    const performance = normalizePerformanceSettings({ ...store.get().performance, ...patch })
    await store.set({ performance })
    deps.changed(performance)
    return performance
  })
  ipc.handle(IPC.invoke.performance.summary, () => deps.responses.summary())
  ipc.handle(IPC.invoke.performance.paint, (_event, value: unknown) => {
    if (!value || typeof value !== 'object') return
    const report = value as ResponsePaint
    if (typeof report.paneId !== 'string' || typeof report.turnId !== 'string' || typeof report.rendererMs !== 'number') return
    deps.responses.paint(report)
  })
}
