import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TraceEntry, TraceKind } from '../../shared/trace.js'

// Loads the trace ring once the panel opens and keeps it live from push events. The renderer
// keeps its own bound so a long-open panel cannot grow past what the main process holds.

const MAX_KEPT = 4_000

export const TRACE_KINDS: readonly TraceKind[] = ['turn', 'tool', 'event', 'raw']

export type TraceTurnGroup = {
  /** Null groups entries that arrived between turns. */
  turnId: string | null
  entries: TraceEntry[]
  startedAt: number
  durationMs: number | null
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
    const visible = entries.filter((entry) => (allPanes || entry.paneId === paneId) && kinds.has(entry.kind))
    return groupByTurn(visible)
  }, [entries, allPanes, paneId, kinds])

  return { groups, total: entries.length, dropped, kinds, toggleKind, allPanes, setAllPanes, error, refresh, clear }
}

/** Consecutive runs of one turn id become a group, newest group first, entries in order. */
export function groupByTurn(entries: TraceEntry[]): TraceTurnGroup[] {
  const groups: TraceTurnGroup[] = []
  let current: TraceTurnGroup | null = null
  for (const entry of entries) {
    // A turn end carries no turn id but belongs to the turn it closes.
    const turnId = entry.label === 'turn.end' && current ? current.turnId : entry.turnId
    if (!current || current.turnId !== turnId) {
      current = { turnId, entries: [], startedAt: entry.at, durationMs: null }
      groups.push(current)
    }
    current.entries.push(entry)
    if (entry.label === 'turn.end' && entry.durationMs !== undefined) current.durationMs = entry.durationMs
  }
  return groups.reverse()
}
