// Sites the user chose to keep, as opposed to browser history (every page visited, pruned by
// frequency) and restored tabs (session state). The record is shaped for a later daily-brief
// agent: the note says why the page matters, and the check fields are its write-back slots.

export type SavedSite = {
  id: string
  url: string
  title: string
  favicon: string | null
  /** Free text captured at save time: why this page matters and what to watch for. */
  note: string
  tags: string[]
  savedAt: number
  updatedAt: number
  /** When a brief last read the page; null until one runs. */
  lastCheckedAt: number | null
  /** What that read concluded; null until one runs. */
  lastSummary: string | null
}

export type SavedSiteDraft = {
  url: string
  title?: string
  favicon?: string | null
  note?: string
  tags?: string[]
}

/** Fields the user edits after saving; the URL is the identity and does not change. */
export type SavedSitePatch = {
  title?: string
  note?: string
  tags?: string[]
}

/**
 * Identity of a saved web page: host without a leading www., plus path, query, and hash, no
 * scheme. Empty for anything that is not an http(s) page, which is what makes it unsaveable.
 * Pure so the renderer can ask "is this tab saved" without a round trip.
 */
export function savedSiteKey(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return ''
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
  const host = url.host.replace(/^www\./, '')
  const rest = (url.pathname === '/' ? '' : url.pathname) + url.search + url.hash
  return (host + rest).toLowerCase()
}
