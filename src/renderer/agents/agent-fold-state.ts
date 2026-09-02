import { useCallback, useEffect, useState } from 'react'

const COLLAPSED_PARENTS_KEY = 'closedai.agents.collapsedParents'
const EXPANDED_SETTLED_KEY = 'closedai.agents.expandedSettled'

export type FoldSet = [
  ReadonlySet<string>,
  (id: string) => void,
  (id: string) => void
]

export function useCollapsedParents(): FoldSet {
  return usePersistedIdSet(COLLAPSED_PARENTS_KEY)
}

export function useExpandedSettled(): FoldSet {
  return usePersistedIdSet(EXPANDED_SETTLED_KEY)
}

function readIdSet(key: string): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return new Set(parsed)
    }
    return new Set()
  } catch {
    return new Set()
  }
}

function writeIdSet(key: string, ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...ids]))
  } catch {
    // Suppress storage failures
  }
}

function usePersistedIdSet(key: string): FoldSet {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => readIdSet(key))
  const toggle = useCallback((id: string) => setIds((previous) => toggleId(previous, id)), [])
  const retract = useCallback((id: string) => setIds((previous) => removeId(previous, id)), [])
  useEffect(() => {
    writeIdSet(key, ids)
  }, [key, ids])
  return [ids, toggle, retract]
}

export function toggleId(previous: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(previous)
  if (!next.delete(id)) next.add(id)
  return next
}

export function removeId(previous: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!previous.has(id)) return previous
  const next = new Set(previous)
  next.delete(id)
  return next
}
