import { mkdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatTranscriptItem } from '../../shared/chat.js'
import type {
  ChatIndexSearchHit,
  ChatIndexSearchRequest,
  ChatIndexSearchResult,
  ChatPaneLexicalIndexRecord
} from '../../shared/chat-index.js'
import {
  CHAT_PANE_LEXICAL_INDEX_VERSION,
  DEFAULT_CHAT_PANE_LEXICAL_MAX_CHARS
} from '../../shared/chat-index.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import type { AppSettings } from '../../shared/types.js'
import { mergePaneIndexLines } from './chat-pane-index-lines.js'
import { PaneIndexWorker } from './pane-index-worker-client.js'
import { writeAtomic } from '../atomic-write.js'
import { matchLabel, matchText, prepareTextQuery } from './forgiving-text-match.js'

export type ChatPaneLexicalIndexSettings = Pick<AppSettings, 'chatMemoryIndexEnabled' | 'chatMemoryIndexMaxCharsPerChat'>

const WRITE_DELAY_MS = 400
const SEARCH_SNIPPET_CHARS = 400
const SEARCH_DEFAULT_LIMIT = 5
const SEARCH_MAX_LIMIT = 8

function indexActivity(record: ChatRecord): number {
  return record.messageSentAt ?? record.lastTurnEndedAt ?? record.createdAt
}

function sanitizeChatFileName(chatId: string): string {
  return chatId.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

export function lexicalQueryTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/** Multi-term AND match with a simple coverage score (no embeddings). */
export function scoreLexicalLineMatch(terms: string[], text: string): number | null {
  if (!terms.length) return null
  const haystack = text.toLowerCase()
  let score = 0
  for (const term of terms) {
    const index = haystack.indexOf(term)
    if (index < 0) return null
    score += term.length / Math.max(text.length, term.length)
    score += 0.05 * (1 - index / Math.max(haystack.length, 1))
  }
  return score / terms.length
}

/** Per-pane lexical index over merged transcript lines for scope chat search. */
export class ChatPaneLexicalIndex {
  private readonly records = new Map<string, ChatPaneLexicalIndexRecord>()
  private writeTimer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  private loaded = false
  private readonly dirty = new Set<string>()
  private manifestDirty = false
  private readonly fts: PaneIndexWorker | null

  constructor(
    private readonly dir: string | null,
    private readonly settings: () => ChatPaneLexicalIndexSettings,
    workerUrl?: URL
  ) {
    this.fts = dir && workerUrl ? new PaneIndexWorker(workerUrl, dir) : null
  }

  static inMemory(settings: ChatPaneLexicalIndexSettings, records: ChatPaneLexicalIndexRecord[] = []): ChatPaneLexicalIndex {
    const index = new ChatPaneLexicalIndex(null, () => settings)
    index.loaded = true
    for (const record of records) index.records.set(record.chatId, record)
    return index
  }

  async load(): Promise<void> {
    if (this.loaded || !this.dir) {
      this.loaded = true
      return
    }
    await mkdir(this.dir, { recursive: true })
    let names: string[] = []
    try {
      names = (await readFile(join(this.dir, 'manifest.json'), 'utf8').then((raw) => {
        const parsed = JSON.parse(raw) as { chatIds?: string[] }
        return Array.isArray(parsed?.chatIds) ? parsed.chatIds : []
      })).filter(Boolean)
    } catch {
      names = []
    }
    for (const chatId of names) {
      const record = await this.readRecord(chatId)
      if (record) this.records.set(chatId, record)
    }
    this.loaded = true
  }

  upsert(
    record: ChatRecord,
    items: ChatTranscriptItem[],
    meta: { rotationEpoch: number; partial: boolean }
  ): void {
    if (!this.settings().chatMemoryIndexEnabled || record.archived) {
      this.drop(record.id)
      return
    }
    const maxChars = Math.max(
      DEFAULT_CHAT_PANE_LEXICAL_MAX_CHARS,
      this.settings().chatMemoryIndexMaxCharsPerChat ?? 0
    )
    const lines = mergePaneIndexLines(items, record, maxChars)
    if (!lines.length) {
      this.drop(record.id)
      return
    }
    const entry: ChatPaneLexicalIndexRecord = {
      version: CHAT_PANE_LEXICAL_INDEX_VERSION,
      chatId: record.id,
      cwd: record.cwd,
      title: record.title,
      lastActivityAt: indexActivity(record),
      rotationEpoch: meta.rotationEpoch,
      partial: meta.partial,
      lines,
      updatedAt: Date.now()
    }
    const previous = this.records.get(record.id)
    if (previous && JSON.stringify({ ...previous, updatedAt: 0 }) === JSON.stringify({ ...entry, updatedAt: 0 })) return
    if (!previous) this.manifestDirty = true
    this.records.set(record.id, entry)
    this.dirty.add(record.id)
    this.scheduleWrite()
  }

  drop(chatId: string): void {
    if (!this.records.delete(chatId)) return
    this.manifestDirty = true
    this.dirty.add(chatId)
    this.scheduleWrite()
  }

  getRecord(chatId: string): ChatPaneLexicalIndexRecord | undefined {
    return this.records.get(chatId)
  }

  async searchPane(chatId: string, request: ChatIndexSearchRequest): Promise<ChatIndexSearchResult> {
    const empty: ChatIndexSearchResult = {
      hits: [],
      indexedChatCount: this.records.has(chatId) ? 1 : 0,
      maxChats: 1,
      scope: 'chat',
      trust: 'historical-data'
    }
    if (!this.settings().chatMemoryIndexEnabled) return empty
    const query = request.query?.trim()
    if (!query) return empty
    const record = this.records.get(chatId)
    if (!record) return { ...empty, indexPartial: true }
    const limit = Math.max(1, Math.min(SEARCH_MAX_LIMIT, Math.floor(request.limit ?? SEARCH_DEFAULT_LIMIT)))
    const literal = await this.searchPaneFts(query, limit, record) ?? this.searchPaneScan(record, query, limit)
    const hits = literal.length ? literal : this.searchPaneForgiving(record, query, limit)
    return {
      hits,
      indexedChatCount: 1,
      maxChats: 1,
      scope: 'chat',
      rotationEpoch: record.rotationEpoch,
      indexPartial: record.partial,
      trust: 'historical-data'
    }
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.writing = this.writing.catch(() => {}).then(() => this.persist())
    await this.writing
  }

  private async readRecord(chatId: string): Promise<ChatPaneLexicalIndexRecord | null> {
    if (!this.dir) return this.records.get(chatId) ?? null
    try {
      const raw = await readFile(join(this.dir, `${sanitizeChatFileName(chatId)}.json`), 'utf8')
      const parsed = JSON.parse(raw) as ChatPaneLexicalIndexRecord
      if (parsed?.version !== CHAT_PANE_LEXICAL_INDEX_VERSION || parsed.chatId !== chatId) return null
      return parsed
    } catch {
      return null
    }
  }

  private scheduleWrite(): void {
    if (!this.dir) return
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.writing = this.writing.catch(() => {}).then(() => this.persist())
      void this.writing.catch((error: unknown) => console.warn('[pane-index] persistence failed:', error))
    }, WRITE_DELAY_MS)
  }

  private async persist(): Promise<void> {
    if (!this.dir || (!this.dirty.size && !this.manifestDirty)) return
    const dirty = [...this.dirty]
    this.dirty.clear()
    const manifestDirty = this.manifestDirty
    this.manifestDirty = false
    try {
      // Serialize writes and removals together so a queued write cannot resurrect a dropped chat.
      for (const chatId of dirty) {
        const record = this.records.get(chatId)
        const path = join(this.dir, `${sanitizeChatFileName(chatId)}.json`)
        if (record) await writeAtomic(path, JSON.stringify(record))
        else await unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
      }
      if (manifestDirty) {
        const chatIds = [...this.records.keys()].sort()
        await writeAtomic(join(this.dir, 'manifest.json'), JSON.stringify({ chatIds, updatedAt: Date.now(), ftsSchema: 1 }))
      }
    } catch (error) {
      for (const chatId of dirty) this.dirty.add(chatId)
      this.manifestDirty ||= manifestDirty
      throw error
    }
  }

  async close(): Promise<void> {
    this.fts?.close()
    await this.flush()
  }

  private async searchPaneFts(
    query: string,
    limit: number,
    record: ChatPaneLexicalIndexRecord
  ): Promise<ChatIndexSearchHit[] | null> {
    if (!this.fts) return null
    try {
      const rows = await this.fts.search(record, query, limit)
      return rows.map((row) => ({
        chatId: record.chatId,
        itemId: row.itemId,
        role: row.role,
        snippet: clip(row.text, SEARCH_SNIPPET_CHARS),
        score: row.score,
        lastActivityAt: record.lastActivityAt,
        cwd: record.cwd,
        title: record.title,
        evidenceAvailability: { status: 'not-checked' as const }
      }))
    } catch {
      // Never serve stale SQLite rows after an update failure.
      return null
    }
  }

  private searchPaneScan(record: ChatPaneLexicalIndexRecord, query: string, limit: number): ChatIndexSearchHit[] {
    const terms = lexicalQueryTerms(query)
    const candidates: ChatIndexSearchHit[] = []
    for (const line of record.lines) {
      const matchScore = scoreLexicalLineMatch(terms, line.text)
      if (matchScore === null) continue
      candidates.push({
        chatId: record.chatId,
        itemId: line.itemId,
        role: line.role,
        snippet: clip(line.text, SEARCH_SNIPPET_CHARS),
        score: matchScore,
        lastActivityAt: record.lastActivityAt,
        cwd: record.cwd,
        title: record.title,
        evidenceAvailability: { status: 'not-checked' }
      })
    }
    candidates.sort((a, b) => b.score - a.score || a.itemId.localeCompare(b.itemId))
    return candidates.slice(0, limit)
  }

  /** Spacing, punctuation, then typo tolerance over the authoritative JSON lines when literal terms find nothing. */
  private searchPaneForgiving(record: ChatPaneLexicalIndexRecord, query: string, limit: number): ChatIndexSearchHit[] {
    const prepared = prepareTextQuery(query)
    if (!prepared) return []
    const scan = (fuzzy: boolean): ChatIndexSearchHit[] => {
      const candidates: ChatIndexSearchHit[] = []
      for (const line of record.lines) {
        const match = matchText(prepared, line.text, { fuzzy })
        if (!match) continue
        candidates.push({
          chatId: record.chatId,
          itemId: line.itemId,
          role: line.role,
          snippet: clip(line.text.slice(Math.max(0, match.start - 80)), SEARCH_SNIPPET_CHARS),
          ...matchLabel(match, line.text),
          score: match.quality,
          lastActivityAt: record.lastActivityAt,
          cwd: record.cwd,
          title: record.title,
          evidenceAvailability: { status: 'not-checked' }
        })
      }
      return candidates
    }
    const spaced = scan(false)
    const candidates = spaced.length ? spaced : scan(true)
    candidates.sort((a, b) => b.score - a.score || a.itemId.localeCompare(b.itemId))
    return candidates.slice(0, limit)
  }
}
