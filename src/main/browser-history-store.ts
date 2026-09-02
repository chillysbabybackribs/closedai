import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { writeAtomic } from './atomic-write.js'

// One visited page. `key` is the deduplication identity (the typed/completed form
// without scheme or a leading www.), `url` is the real address we navigate to.
export type HistoryEntry = {
  key: string
  url: string
  title: string
  visitCount: number
  lastVisitedAt: number
}

type PersistedHistory = {
  version: 1
  entries: HistoryEntry[]
}

const WRITE_DEBOUNCE_MS = 250
// Keep the file bounded; the omnibox only ever needs the frequent/recent tail.
const MAX_ENTRIES = 2000

export interface BrowserHistory {
  record(rawUrl: string, title: string): void
  updateTitle(rawUrl: string, title: string): void
  suggest(input: string): { completion: string; url: string } | null
  setAgentDriven?(driven: boolean): void
}

// Agent-owned browser activity must not pollute the user's omnibox history.
export const EPHEMERAL_BROWSER_HISTORY: BrowserHistory = {
  record: () => {},
  updateTitle: () => {},
  suggest: () => null
}

// A foreground tab can move between human-owned and agent-driven use without being
// recreated. Route only its mutations to the ephemeral sink while a live lease drives
// it; suggestions always remain backed by the user's persisted history, including when
// the user types in the visible omnibox during a running turn.
export class LeasedTabBrowserHistory implements BrowserHistory {
  private agentDriven = false

  constructor(private readonly persisted: BrowserHistory) {}

  setAgentDriven(driven: boolean): void {
    this.agentDriven = driven
  }

  record(rawUrl: string, title: string): void {
    this.writable().record(rawUrl, title)
  }

  updateTitle(rawUrl: string, title: string): void {
    this.writable().updateTitle(rawUrl, title)
  }

  suggest(input: string): { completion: string; url: string } | null {
    return this.persisted.suggest(input)
  }

  private writable(): BrowserHistory {
    return this.agentDriven ? EPHEMERAL_BROWSER_HISTORY : this.persisted
  }
}

// Persisted log of visited pages, backing omnibox inline-autocomplete. Kept
// separate from chat history: different lifecycle, different shape, and the
// browser can be used without ever touching chat. Same atomic-write + debounce
// discipline as ChatHistoryStore so a crash mid-write can't corrupt the file.
export class BrowserHistoryStore extends EventEmitter implements BrowserHistory {
  private state: PersistedHistory
  private writeQueue: Promise<void> = Promise.resolve()
  private writeTimer: ReturnType<typeof setTimeout> | null = null

  private constructor(
    private readonly filePath: string,
    state: PersistedHistory
  ) {
    super()
    this.state = state
  }

  static async open(filePath: string): Promise<BrowserHistoryStore> {
    const state = await readHistory(filePath)
    return new BrowserHistoryStore(filePath, state ?? { version: 1, entries: [] })
  }

  // Record a completed navigation. Only real, addressable http(s) URLs are kept —
  // about:blank, file://, and the like are not useful omnibox completions.
  record(rawUrl: string, title: string): void {
    const key = historyKey(rawUrl)
    if (!key) return

    const now = Date.now()
    const existing = this.state.entries.find((entry) => entry.key === key)
    if (existing) {
      existing.url = rawUrl
      if (title.trim()) existing.title = title.trim()
      existing.visitCount += 1
      existing.lastVisitedAt = now
    } else {
      this.state.entries.push({
        key,
        url: rawUrl,
        title: title.trim(),
        visitCount: 1,
        lastVisitedAt: now
      })
    }
    this.prune()
    this.scheduleWrite()
  }

  // Update the title for an already-recorded URL once the page reports one
  // (titles usually arrive after did-navigate). No-op if the URL isn't tracked.
  updateTitle(rawUrl: string, title: string): void {
    const key = historyKey(rawUrl)
    if (!key || !title.trim()) return
    const existing = this.state.entries.find((entry) => entry.key === key)
    if (!existing || existing.title === title.trim()) return
    existing.title = title.trim()
    this.scheduleWrite()
  }

  // Best inline-autocomplete for what the user has typed so far. Matches against
  // the scheme-less key (people type "git", not "https://git"), ranks by visit
  // frequency then recency, and returns both the value to display in the omnibox
  // (the completed key) and the URL to navigate to on Enter.
  suggest(input: string): { completion: string; url: string } | null {
    const typed = input.trim().toLowerCase()
    if (!typed) return null
    // If the user is typing a scheme explicitly, match on that same basis so the
    // inline completion doesn't fight what they see.
    const typedKey = historyKeyFromTyped(typed)
    if (!typedKey) return null

    const matches = this.state.entries
      .filter((entry) => entry.key.startsWith(typedKey) && entry.key !== typedKey)
      .sort(
        (a, b) => b.visitCount - a.visitCount || b.lastVisitedAt - a.lastVisitedAt
      )
    const best = matches[0]
    if (!best) return null
    return { completion: best.key, url: best.url }
  }

  private prune(): void {
    if (this.state.entries.length <= MAX_ENTRIES) return
    this.state.entries.sort(
      (a, b) => b.visitCount - a.visitCount || b.lastVisitedAt - a.lastVisitedAt
    )
    this.state.entries.length = MAX_ENTRIES
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

  private scheduleWrite(): void {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      void this.flush()
    }, WRITE_DEBOUNCE_MS)
  }
}

// Deduplication/completion identity for a real URL: host (minus leading www.)
// plus path/query/hash, no scheme. Returns '' for anything not worth completing.
function historyKey(rawUrl: string): string {
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

// Normalize what the user typed to the same basis as historyKey, so a typed
// prefix can be matched against stored keys. Strips a scheme and leading www.
// if present; leaves partial/incomplete input otherwise intact.
function historyKeyFromTyped(typed: string): string {
  const withoutScheme = typed.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  return withoutScheme.replace(/^www\./, '')
}

type MaybePersisted = { version?: unknown; entries?: unknown }

async function readHistory(filePath: string): Promise<PersistedHistory | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as MaybePersisted
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return null
    const entries = parsed.entries
      .map(normalizeEntry)
      .filter((entry): entry is HistoryEntry => entry !== null)
    return { version: 1, entries }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code !== 'ENOENT') console.warn('Unable to read browser history; starting clean', error)
    return null
  }
}

function normalizeEntry(value: unknown): HistoryEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<HistoryEntry>
  if (typeof entry.url !== 'string') return null
  const key = typeof entry.key === 'string' && entry.key ? entry.key : historyKey(entry.url)
  if (!key) return null
  return {
    key,
    url: entry.url,
    title: typeof entry.title === 'string' ? entry.title : '',
    visitCount: typeof entry.visitCount === 'number' && entry.visitCount > 0 ? entry.visitCount : 1,
    lastVisitedAt: typeof entry.lastVisitedAt === 'number' ? entry.lastVisitedAt : 0
  }
}
