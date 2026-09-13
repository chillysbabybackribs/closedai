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

/** Serialize a live navigation stack for session restore. Returns null when a URL load suffices. */
export function exportNavigationStack(
  entries: NavigationEntry[],
  activeIndex: number
): PersistedNavigationStack | null {
  const kept = entries
    .filter((entry) => isRestorableNavigationUrl(entry.url))
    .slice(-MAX_PERSISTED_NAVIGATION_ENTRIES)
    .map((entry) => ({
      url: entry.url,
      title: typeof entry.title === 'string' ? entry.title.slice(0, 300) : '',
      ...(typeof entry.pageState === 'string' && entry.pageState.length > 0
        ? { pageState: entry.pageState }
        : {})
    }))
  if (kept.length <= 1) return null
  const index = Math.min(Math.max(activeIndex, 0), kept.length - 1)
  return { entries: kept, index }
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
  if (entries.length <= 1) return null
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
