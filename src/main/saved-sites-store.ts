import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { selectFavicon } from './browser-favicon.js'
import { historyKey } from './browser-history-store.js'
import { writeAtomic } from './atomic-write.js'
import type { BrowserHistoryMatch } from '../shared/browser-history.js'
import type { SavedSite, SavedSiteDraft, SavedSitePatch } from '../shared/saved-sites.js'

// Sites the user chose to keep. Separate from browser history on purpose: history is every
// page visited, pruned by frequency and skipped for agent-driven tabs, so it cannot carry
// intent. This file is small, never pruned, and is what a daily-brief agent will read.
// Same atomic-write + debounce discipline as BrowserHistoryStore.

type PersistedSavedSites = {
  version: 1
  sites: SavedSite[]
}

const WRITE_DEBOUNCE_MS = 250
const MAX_NOTE_LENGTH = 4000
const MAX_TAGS = 32
const SUGGESTION_LIMIT = 6

export class SavedSitesStore extends EventEmitter {
  private state: PersistedSavedSites
  private writeQueue: Promise<void> = Promise.resolve()
  private writeTimer: ReturnType<typeof setTimeout> | null = null

  private constructor(
    private readonly filePath: string,
    state: PersistedSavedSites
  ) {
    super()
    this.state = state
  }

  static async open(filePath: string): Promise<SavedSitesStore> {
    const state = await readSavedSites(filePath)
    return new SavedSitesStore(filePath, state ?? { version: 1, sites: [] })
  }

  /** Newest first, so the shelf and a brief both see the latest save at the top. */
  list(): SavedSite[] {
    return [...this.state.sites].sort((a, b) => b.savedAt - a.savedAt).map((site) => ({ ...site, tags: [...site.tags] }))
  }

  findByUrl(url: string): SavedSite | null {
    const key = historyKey(url)
    if (!key) return null
    return this.state.sites.find((site) => historyKey(site.url) === key) ?? null
  }

  // Saving an already-saved URL refreshes its title/favicon rather than duplicating it, so
  // the star and the tab menu can both call this without checking first.
  save(draft: SavedSiteDraft): SavedSite {
    const url = typeof draft.url === 'string' ? draft.url.trim() : ''
    if (!historyKey(url)) throw new Error('Only web pages (http or https) can be saved')
    const now = Date.now()
    const existing = this.findByUrl(url)
    if (existing) {
      const title = cleanTitle(draft.title)
      if (title) existing.title = title
      const favicon = cleanFavicon(draft.favicon)
      if (favicon) existing.favicon = favicon
      if (typeof draft.note === 'string') existing.note = cleanNote(draft.note)
      if (draft.tags) existing.tags = cleanTags(draft.tags)
      existing.updatedAt = now
      this.changed()
      return { ...existing }
    }
    const site: SavedSite = {
      id: randomUUID(),
      url,
      title: cleanTitle(draft.title),
      favicon: cleanFavicon(draft.favicon),
      note: cleanNote(draft.note ?? ''),
      tags: cleanTags(draft.tags ?? []),
      savedAt: now,
      updatedAt: now,
      lastCheckedAt: null,
      lastSummary: null
    }
    this.state.sites.push(site)
    this.changed()
    return { ...site }
  }

  update(id: string, patch: SavedSitePatch): SavedSite | null {
    const site = this.state.sites.find((candidate) => candidate.id === id)
    if (!site) return null
    if (typeof patch.title === 'string') site.title = cleanTitle(patch.title)
    if (typeof patch.note === 'string') site.note = cleanNote(patch.note)
    if (patch.tags) site.tags = cleanTags(patch.tags)
    site.updatedAt = Date.now()
    this.changed()
    return { ...site }
  }

  remove(id: string): void {
    const before = this.state.sites.length
    this.state.sites = this.state.sites.filter((site) => site.id !== id)
    if (this.state.sites.length !== before) this.changed()
  }

  /** Omnibox rows for saved sites; the caller places them ahead of history matches. */
  search(input: string): BrowserHistoryMatch[] {
    const query = input.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
    return this.list()
      .filter((site) => {
        const key = historyKey(site.url)
        return !query || key.includes(query) || site.title.toLowerCase().includes(query) || site.note.toLowerCase().includes(query)
      })
      .slice(0, SUGGESTION_LIMIT)
      .map((site) => ({
        url: site.url,
        title: site.title,
        completion: historyKey(site.url),
        favicon: site.favicon ?? new URL('/favicon.ico', site.url).href,
        saved: true
      }))
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    const snapshot = JSON.stringify(this.state)
    this.writeQueue = this.writeQueue.then(() => writeAtomic(this.filePath, snapshot))
    await this.writeQueue
  }

  private changed(): void {
    this.scheduleWrite()
    this.emit('changed', this.list())
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      void this.flush()
    }, WRITE_DEBOUNCE_MS)
  }
}

// Saved sites first, then history rows that are not already covered by a saved site, within
// the same six-row budget the omnibox already lays out.
export function rankSavedFirst(saved: BrowserHistoryMatch[], history: BrowserHistoryMatch[]): BrowserHistoryMatch[] {
  const covered = new Set(saved.map((row) => historyKey(row.url)))
  const rest = history.filter((row) => !covered.has(historyKey(row.url)))
  return [...saved, ...rest].slice(0, SUGGESTION_LIMIT)
}

function cleanTitle(title: unknown): string {
  return typeof title === 'string' ? title.trim().slice(0, 500) : ''
}

function cleanNote(note: unknown): string {
  return typeof note === 'string' ? note.trim().slice(0, MAX_NOTE_LENGTH) : ''
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  for (const tag of tags) {
    if (typeof tag !== 'string') continue
    const clean = tag.trim().toLowerCase().slice(0, 64)
    if (clean) seen.add(clean)
    if (seen.size >= MAX_TAGS) break
  }
  return [...seen]
}

function cleanFavicon(favicon: unknown): string | null {
  return typeof favicon === 'string' && favicon ? selectFavicon([favicon]) ?? null : null
}

type MaybePersisted = { version?: unknown; sites?: unknown }

async function readSavedSites(filePath: string): Promise<PersistedSavedSites | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as MaybePersisted
    if (parsed.version !== 1 || !Array.isArray(parsed.sites)) return null
    const sites = parsed.sites.map(normalizeSite).filter((site): site is SavedSite => site !== null)
    return { version: 1, sites }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code !== 'ENOENT') console.warn('Unable to read saved sites; starting clean', error)
    return null
  }
}

function normalizeSite(value: unknown): SavedSite | null {
  if (!value || typeof value !== 'object') return null
  const site = value as Partial<SavedSite>
  if (typeof site.url !== 'string' || !historyKey(site.url)) return null
  const savedAt = typeof site.savedAt === 'number' ? site.savedAt : 0
  return {
    id: typeof site.id === 'string' && site.id ? site.id : randomUUID(),
    url: site.url,
    title: cleanTitle(site.title),
    favicon: cleanFavicon(site.favicon),
    note: cleanNote(site.note),
    tags: cleanTags(site.tags),
    savedAt,
    updatedAt: typeof site.updatedAt === 'number' ? site.updatedAt : savedAt,
    lastCheckedAt: typeof site.lastCheckedAt === 'number' ? site.lastCheckedAt : null,
    lastSummary: typeof site.lastSummary === 'string' ? site.lastSummary : null
  }
}
