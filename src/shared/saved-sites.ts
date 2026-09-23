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
