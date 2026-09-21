import { useSyncExternalStore } from 'react'

/** Whether the composer shows its collapsed single-line pill or the full card. */
export type ComposerLayout = 'full' | 'compact'

export const COMPOSER_LAYOUT_STORAGE_KEY = 'closedai.composer-layout.v1'

type LayoutStorage = Pick<Storage, 'getItem' | 'setItem'>

export function normalizeComposerLayout(value: unknown): ComposerLayout {
  return value === 'compact' ? 'compact' : 'full'
}

export function readComposerLayout(storage: Pick<LayoutStorage, 'getItem'>): ComposerLayout {
  try {
    return normalizeComposerLayout(storage.getItem(COMPOSER_LAYOUT_STORAGE_KEY))
  } catch {
    return 'full'
  }
}

export function persistComposerLayout(storage: Pick<LayoutStorage, 'setItem'>, layout: ComposerLayout): void {
  try {
    storage.setItem(COMPOSER_LAYOUT_STORAGE_KEY, layout)
  } catch {
    // The toggle still works for this session when storage is unavailable or full.
  }
}

/* One store for every composer: the chevron is an app-wide preference, so collapsing one pane
   collapses new and sibling panes too, and the choice comes back after a restart. Read lazily so
   tests and the preview can swap window.localStorage before the first composer mounts. */
let current: ComposerLayout | null = null
const listeners = new Set<() => void>()

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

export function getComposerLayout(): ComposerLayout {
  if (current === null) {
    const store = storage()
    current = store ? readComposerLayout(store) : 'full'
  }
  return current
}

export function setComposerLayout(layout: ComposerLayout): void {
  if (layout === current) return
  current = layout
  const store = storage()
  if (store) persistComposerLayout(store, layout)
  for (const listener of listeners) listener()
}

/** Test seam: forget the cached value so the next read hits storage again. */
export function resetComposerLayoutCache(): void {
  current = null
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useComposerLayout(): [ComposerLayout, (layout: ComposerLayout) => void] {
  const layout = useSyncExternalStore(subscribe, getComposerLayout, getComposerLayout)
  return [layout, setComposerLayout]
}
