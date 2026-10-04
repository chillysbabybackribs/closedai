import { useCallback, useEffect, useState } from 'react'
import type { ToolCallEvent, ToolManifest, ToolSwitch, ToolTelemetrySnapshot } from '../../shared/tools.js'
import { errorMessage } from '../error-message.js'

export type ToolsController = {
  manifest: ToolManifest | null
  telemetry: ToolTelemetrySnapshot | null
  error: string | null
  refresh: () => Promise<void>
  clearTelemetry: () => Promise<void>
  setEnabled: (toolId: string, enabled: boolean) => Promise<void>
  /** One row, one group, or a preset: applied optimistically, persisted once, then re-read. */
  setEnabledMany: (switches: ToolSwitch[]) => Promise<void>
  chatCursorBaselineEnabled: boolean
  setChatCursorBaselineEnabled: (enabled: boolean) => Promise<void>
  chatToolSliceEnabled: boolean
  setChatToolSliceEnabled: (enabled: boolean) => Promise<void>
  chatWorkspaceLedgerEnabled: boolean
  setChatWorkspaceLedgerEnabled: (enabled: boolean) => Promise<void>
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
      setError(errorMessage(caught, 'Tool settings could not be read.'))
    }
  }, [])

  useEffect(() => {
    if (!active) return
    let live = true
    void refresh()
    const unsubscribe = window.closedai.tools.onEvent((event) => {
      if (!live) return
      if (event.type === 'cleared') {
        setTelemetry((current) => current ? { ...current, stats: [], totalCalls: 0, errors: [], since: Date.now() } : current)
        return
      }
      if (event.type === 'enabled') {
        setManifest((current) => current ? withEnabled(current, event.toolId, event.enabled) : current)
        return
      }
      if (event.type === 'changed') {
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
    try {
      await window.closedai.tools.clearTelemetry()
    } catch (caught) {
      setError(errorMessage(caught, 'Tool activity could not be cleared.'))
      return
    }
    await refresh()
  }, [refresh])

  const setEnabled = useCallback(async (toolId: string, enabled: boolean) => {
    // Optimistic; the main process confirms with an 'enabled' event or the refresh reverts it.
    setManifest((current) => current ? withEnabled(current, toolId, enabled) : current)
    try {
      await window.closedai.tools.setEnabled(toolId, enabled)
    } catch (caught) {
      setError(errorMessage(caught))
      await refresh()
    }
  }, [refresh])

  const setEnabledMany = useCallback(async (switches: ToolSwitch[]) => {
    setManifest((current) => current
      ? switches.reduce((next, { id, enabled }) => withEnabled(next, id, enabled), current)
      : current)
    try {
      await window.closedai.tools.setEnabledMany(switches)
    } catch (caught) {
      setError(errorMessage(caught))
    }
    // Bulk changes emit no per-id events; the manifest's cost total comes back from this read.
    await refresh()
  }, [refresh])

  const setChatCursorBaselineEnabled = useCallback(async (enabled: boolean) => {
    setManifest((current) => current ? { ...current, chatCursorBaselineEnabled: enabled } : current)
    try {
      await window.closedai.tools.setChatCursorBaselineEnabled(enabled)
    } catch (caught) {
      setError(errorMessage(caught))
      await refresh()
    }
  }, [refresh])

  const setChatToolSliceEnabled = useCallback(async (enabled: boolean) => {
    setManifest((current) => current ? { ...current, chatToolSliceEnabled: enabled } : current)
    try {
      await window.closedai.tools.setChatToolSliceEnabled(enabled)
    } catch (caught) {
      setError(errorMessage(caught))
      await refresh()
    }
  }, [refresh])

  const setChatWorkspaceLedgerEnabled = useCallback(async (enabled: boolean) => {
    setManifest((current) => current ? { ...current, chatWorkspaceLedgerEnabled: enabled } : current)
    try {
      await window.closedai.tools.setChatWorkspaceLedgerEnabled(enabled)
    } catch (caught) {
      setError(errorMessage(caught))
      await refresh()
    }
  }, [refresh])

  return {
    manifest,
    telemetry,
    error,
    refresh,
    clearTelemetry,
    setEnabled,
    setEnabledMany,
    chatCursorBaselineEnabled: manifest?.chatCursorBaselineEnabled === true,
    setChatCursorBaselineEnabled,
    chatToolSliceEnabled: manifest?.chatToolSliceEnabled !== false,
    setChatToolSliceEnabled,
    chatWorkspaceLedgerEnabled: manifest?.chatWorkspaceLedgerEnabled !== false,
    setChatWorkspaceLedgerEnabled
  }
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

/** Failure notes kept per tool in the live snapshot; the main process keeps the same number. */
const ERROR_NOTES_PER_TOOL = 3

/** Fold one new call into the snapshot so the modal updates without a round trip. */
export function applyRecord(snapshot: ToolTelemetrySnapshot, record: ToolCallEvent): ToolTelemetrySnapshot {
  const keys: Array<string | null> = record.action ? [null, record.action] : [null]
  let stats = snapshot.stats
  const failed = !record.ok && !record.timedOut
  for (const action of keys) {
    const existing = stats.find((stat) => stat.toolId === record.toolId && stat.action === action)
      ?? { toolId: record.toolId, action, calls: 0, failures: 0, timeouts: 0, misuses: 0, lastCalledAt: null, lastFailedAt: null }
    const updated = {
      ...existing,
      calls: existing.calls + 1,
      failures: existing.failures + (failed ? 1 : 0),
      timeouts: existing.timeouts + (record.timedOut ? 1 : 0),
      misuses: existing.misuses + (failed && record.misuse ? 1 : 0),
      lastCalledAt: record.at || existing.lastCalledAt,
      lastFailedAt: record.ok ? existing.lastFailedAt : (record.at || existing.lastFailedAt)
    }
    stats = [updated, ...stats.filter((stat) => !(stat.toolId === record.toolId && stat.action === action))]
  }
  let errors = snapshot.errors
  if (!record.ok && record.message) {
    const note = {
      toolId: record.toolId,
      action: record.action,
      at: record.at,
      kind: record.timedOut ? 'timeout' as const : record.misuse ? 'misuse' as const : 'error' as const,
      message: record.message
    }
    errors = [
      note,
      ...errors.filter((entry) => entry.toolId === record.toolId).slice(0, ERROR_NOTES_PER_TOOL - 1),
      ...errors.filter((entry) => entry.toolId !== record.toolId)
    ]
  }
  return { ...snapshot, stats, errors, totalCalls: snapshot.totalCalls + 1 }
}
