import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TraceEntry, TraceKind } from '../../shared/trace.js'
import { summarizeTracePerformance, type TracePerformance } from './trace-performance.js'

// Loads the trace ring once the panel opens and keeps it live from push events. The renderer
// keeps its own bound so a long-open panel cannot grow past what the main process holds.

const MAX_KEPT = 4_000

export const TRACE_KINDS: readonly TraceKind[] = ['turn', 'tool', 'event', 'raw', 'note']

export type TraceTurnGroup = {
  /** Null groups entries that arrived between turns. */
  turnId: string | null
  entries: TraceEntry[]
  startedAt: number
  durationMs: number | null
  performance: TracePerformance
}

export type TraceController = {
  groups: TraceTurnGroup[]
  total: number
  dropped: number
  kinds: Set<TraceKind>
  toggleKind: (kind: TraceKind) => void
  allPanes: boolean
  setAllPanes: (all: boolean) => void
  error: string | null
  refresh: () => Promise<void>
  clear: () => Promise<void>
}

export function useTraceController(active: boolean, paneId: string): TraceController {
  const [entries, setEntries] = useState<TraceEntry[]>([])
  const [dropped, setDropped] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [kinds, setKinds] = useState<Set<TraceKind>>(() => new Set(['turn', 'tool', 'event']))
  const [allPanes, setAllPanes] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const snapshot = await window.closedai.trace.snapshot()
      setEntries(snapshot.entries)
      setDropped(snapshot.dropped)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  useEffect(() => {
    if (!active) return
    let live = true
    void refresh()
    window.closedai.trace.setActive(true).catch(console.error)
    const unsubscribe = window.closedai.trace.onEvent((event) => {
      if (!live) return
      if (event.type === 'cleared') {
        setEntries([])
        setDropped(0)
        return
      }
      setEntries((current) => {
        const next = current.length >= MAX_KEPT ? current.slice(current.length - MAX_KEPT + 1) : current.slice()
        next.push(event.entry)
        return next
      })
    })
    return () => {
      live = false
      unsubscribe()
      window.closedai.trace.setActive(false).catch(console.error)
    }
  }, [active, refresh])

  const clear = useCallback(async () => {
    await window.closedai.trace.clear()
  }, [])

  const toggleKind = useCallback((kind: TraceKind) => {
    setKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }, [])

  const groups = useMemo(() => {
    const scoped = entries.filter((entry) => allPanes || entry.paneId === paneId)
    return filterTurnGroups(groupByTurn(scoped), kinds)
  }, [entries, allPanes, paneId, kinds])

  return { groups, total: entries.length, dropped, kinds, toggleKind, allPanes, setAllPanes, error, refresh, clear }
}

/**
 * Consecutive runs of one turn become a group, newest group first, entries in order. Entries
 * without a turn id that arrive while a turn is open (context updates, the turn end itself,
 * provider lines sent before the id is known to be over) belong to that turn.
 */
export function groupByTurn(entries: TraceEntry[]): TraceTurnGroup[] {
  const groups: TraceTurnGroup[] = []
  let current: TraceTurnGroup | null = null
  let openTurnId: string | null = null
  for (const entry of entries) {
    if (entry.label === 'turn.start') openTurnId = entry.turnId
    const turnId: string | null = entry.turnId ?? openTurnId
    if (!current || current.turnId !== turnId) {
      current = {
        turnId, entries: [], startedAt: entry.at, durationMs: null,
        performance: summarizeTracePerformance([], null)
      }
      groups.push(current)
    }
    current.entries.push(entry)
    if (entry.label === 'turn.end') {
      if (entry.durationMs !== undefined) current.durationMs = entry.durationMs
      openTurnId = null
    }
  }
  return groups.reverse().map((group) => ({
    ...group,
    performance: summarizeTracePerformance(group.entries, group.durationMs)
  }))
}

/** Hide row kinds only after grouping, preserving boundaries and performance evidence. */
export function filterTurnGroups(groups: TraceTurnGroup[], kinds: Set<TraceKind>): TraceTurnGroup[] {
  return groups
    .map((group) => ({ ...group, entries: group.entries.filter((entry) => kinds.has(entry.kind)) }))
    .filter((group) => group.entries.length > 0)
}
