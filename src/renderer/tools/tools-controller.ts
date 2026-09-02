import { useCallback, useEffect, useState } from 'react'
import type { ToolCallRecord, ToolManifest, ToolTelemetrySnapshot } from '../../shared/tools.js'

export type ToolsController = {
  manifest: ToolManifest | null
  telemetry: ToolTelemetrySnapshot | null
  error: string | null
  refresh: () => Promise<void>
  clearTelemetry: () => Promise<void>
  setEnabled: (toolId: string, enabled: boolean) => Promise<void>
}

/** Loads the manifest and telemetry while `active`, and keeps telemetry live via push events. */
export function useToolsController(active: boolean): ToolsController {
  const [manifest, setManifest] = useState<ToolManifest | null>(null)
  const [telemetry, setTelemetry] = useState<ToolTelemetrySnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [nextManifest, nextTelemetry] = await Promise.all([
        window.closedai.tools.manifest(),
        window.closedai.tools.telemetry()
      ])
      setManifest(nextManifest)
      setTelemetry(nextTelemetry)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  useEffect(() => {
    if (!active) return
    let live = true
    void refresh()
    const unsubscribe = window.closedai.tools.onEvent((event) => {
      if (!live) return
      if (event.type === 'cleared') {
        setTelemetry((current) => current ? { ...current, stats: [], recent: [] } : current)
        return
      }
      if (event.type === 'enabled') {
        setManifest((current) => current ? withEnabled(current, event.toolId, event.enabled) : current)
        return
      }
      if (event.type === 'registered') {
        void refresh()
        return
      }
      setTelemetry((current) => current ? applyRecord(current, event.record) : current)
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [active, refresh])

  const clearTelemetry = useCallback(async () => {
    await window.closedai.tools.clearTelemetry()
    await refresh()
  }, [refresh])

  const setEnabled = useCallback(async (toolId: string, enabled: boolean) => {
    // Optimistic; the main process confirms with an 'enabled' event or the refresh reverts it.
    setManifest((current) => current ? withEnabled(current, toolId, enabled) : current)
    try {
      await window.closedai.tools.setEnabled(toolId, enabled)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      await refresh()
    }
  }, [refresh])

  return { manifest, telemetry, error, refresh, clearTelemetry, setEnabled }
}

/** Apply a switch to a plain tool (`ns.tool`) or one action (`ns.tool.action`). */
function withEnabled(manifest: ToolManifest, id: string, enabled: boolean): ToolManifest {
  return {
    ...manifest,
    namespaces: manifest.namespaces.map((namespace) => ({
      ...namespace,
      tools: namespace.tools.map((tool) => {
        if (tool.id === id) return { ...tool, enabled }
        if (!tool.actions.some((action) => action.id === id)) return tool
        const actions = tool.actions.map((action) => action.id === id ? { ...action, enabled } : action)
        return { ...tool, actions, enabled: actions.some((action) => action.enabled) }
      })
    }))
  }
}

/** Fold one new call into the snapshot so the modal updates without a round trip. */
export function applyRecord(snapshot: ToolTelemetrySnapshot, record: ToolCallRecord): ToolTelemetrySnapshot {
  const keys: Array<string | null> = record.action ? [null, record.action] : [null]
  let stats = snapshot.stats
  for (const action of keys) {
    const existing = stats.find((stat) => stat.toolId === record.toolId && stat.action === action)
    const updated = existing
      ? {
          ...existing,
          calls: existing.calls + 1,
          failures: existing.failures + (record.ok ? 0 : 1),
          averageMs: Math.round((existing.averageMs * existing.calls + record.durationMs) / (existing.calls + 1)),
          lastAt: Math.max(existing.lastAt ?? 0, record.at)
        }
      : { toolId: record.toolId, action, calls: 1, failures: record.ok ? 0 : 1, averageMs: record.durationMs, lastAt: record.at }
    stats = [updated, ...stats.filter((stat) => !(stat.toolId === record.toolId && stat.action === action))]
  }
  return { ...snapshot, stats, totalCalls: snapshot.totalCalls + 1, recent: [record, ...snapshot.recent].slice(0, 100) }
}
