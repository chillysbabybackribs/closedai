import type { NavigationEntry } from 'electron'

/** One frame in a tab's back/forward stack, persisted across restarts. */
export type PersistedNavigationEntry = {
  url: string
  title: string
  pageState?: string
}

export type PersistedNavigationStack = {
  entries: PersistedNavigationEntry[]
  index: number
}

// A deep stack with pageState blobs can balloon the session file; keep a Chrome-like window.
export const MAX_PERSISTED_NAVIGATION_ENTRIES = 50

export function isRestorableNavigationUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Serialize a live navigation stack for session restore. A single page is kept when it carries
 * page state (its scroll offset and form contents); returns null when a plain URL load suffices.
 */
export function exportNavigationStack(
  entries: NavigationEntry[],
  activeIndex: number
): PersistedNavigationStack | null {
  // Dropping entries renumbers the stack, so the active entry is tracked through the filter:
  // the saved index must name the page the tab was showing, not whatever slid into its slot.
  const restorable = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => isRestorableNavigationUrl(entry.url))
  const windowed = restorable.slice(-MAX_PERSISTED_NAVIGATION_ENTRIES)
  const kept = windowed.map(({ entry }) => ({
    url: entry.url,
    title: typeof entry.title === 'string' ? entry.title.slice(0, 300) : '',
    ...(typeof entry.pageState === 'string' && entry.pageState.length > 0
      ? { pageState: entry.pageState }
      : {})
  }))
  if (!worthRestoring(kept)) return null
  // The active page itself when it survived, else the nearest kept page before it.
  let index = 0
  windowed.forEach(({ index: original }, position) => { if (original <= activeIndex) index = position })
  return { entries: kept, index }
}

/** More than one page to go back through, or one page whose state (scroll offset) a URL load would lose. */
function worthRestoring(entries: PersistedNavigationEntry[]): boolean {
  return entries.length > 1 || (entries.length === 1 && entries[0].pageState !== undefined)
}

/** Re-validate a stack read from disk; malformed stacks fall back to a plain URL load. */
export function normalizeNavigationStack(value: unknown): PersistedNavigationStack | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as Partial<PersistedNavigationStack>
  if (!Array.isArray(parsed.entries)) return null
  const entries = parsed.entries
    .map(normalizeEntry)
    .filter((entry): entry is PersistedNavigationEntry => entry !== null)
    .slice(-MAX_PERSISTED_NAVIGATION_ENTRIES)
  if (!worthRestoring(entries)) return null
  const rawIndex = typeof parsed.index === 'number' ? Math.floor(parsed.index) : entries.length - 1
  const index = Math.min(Math.max(rawIndex, 0), entries.length - 1)
  return { entries, index }
}

function normalizeEntry(value: unknown): PersistedNavigationEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<PersistedNavigationEntry>
  if (typeof entry.url !== 'string' || !isRestorableNavigationUrl(entry.url)) return null
  const title = typeof entry.title === 'string' ? entry.title.slice(0, 300) : ''
  const pageState = typeof entry.pageState === 'string' && entry.pageState.length > 0 ? entry.pageState : undefined
  return pageState ? { url: entry.url, title, pageState } : { url: entry.url, title }
}
