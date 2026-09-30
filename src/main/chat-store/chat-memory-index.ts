import { mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatTranscriptItem } from '../../shared/chat.js'
import type {
  ChatIndexSearchHit,
  ChatIndexSearchRequest,
  ChatIndexSearchResult,
  ChatMemoryIndexManifest,
  ChatMemoryIndexRecord
} from '../../shared/chat-index.js'
import {
  CHAT_MEMORY_INDEX_VERSION,
  DEFAULT_CHAT_MEMORY_INDEX_HALF_LIFE_DAYS,
  DEFAULT_CHAT_MEMORY_INDEX_MAX_CHARS_PER_CHAT,
  DEFAULT_CHAT_MEMORY_INDEX_MAX_CHATS,
  MAX_CHAT_MEMORY_INDEX_MAX_CHATS
} from '../../shared/chat-index.js'
import type { ChatRecord } from '../../shared/chat-store.js'
import { cachedChatThreadId } from './chat-transcript-cache.js'
import type { AppSettings } from '../../shared/types.js'
import {
  conversationSpineChangedFiles
} from '../chat-context/thread-handoff.js'
import { conversationSpineTurns } from '../chat-context/conversation-spine.js'
import { writeAtomic } from '../atomic-write.js'
import { matchLabel, matchText, prepareTextQuery } from './forgiving-text-match.js'

export type ChatMemoryIndexSettings = Pick<
  AppSettings,
  | 'chatMemoryIndexEnabled'
  | 'chatMemoryIndexMaxChats'
  | 'chatMemoryIndexHalfLifeDays'
  | 'chatMemoryIndexMaxCharsPerChat'
>

const WRITE_DELAY_MS = 400
const SEARCH_SNIPPET_CHARS = 400
const SEARCH_DEFAULT_LIMIT = 5
const SEARCH_MAX_LIMIT = 8
const MS_PER_DAY = 86_400_000
const LN2 = Math.LN2

function indexActivity(record: ChatRecord): number {
  return record.messageSentAt ?? record.lastTurnEndedAt ?? record.createdAt
}

function sanitizeChatFileName(chatId: string): string {
  return chatId.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

/** Turn-shaped index lines for hot or pane lexical indexes. */
export function chatIndexLinesFromTranscript(items: ChatTranscriptItem[], maxChars: number): ChatMemoryIndexRecord['lines'] {
  return trimLines(buildLines(items), maxChars)
}

function buildLines(items: ChatTranscriptItem[]): ChatMemoryIndexRecord['lines'] {
  const lines: ChatMemoryIndexRecord['lines'] = []
  for (const turn of conversationSpineTurns(items)) {
    lines.push({ itemId: turn.userItemId, role: 'user', text: turn.userText })
    if (turn.plan) lines.push({ itemId: turn.plan.itemId, role: 'plan', text: turn.plan.text })
    for (const evidence of turn.evidence) lines.push({ itemId: evidence.itemId, role: 'evidence', text: evidence.text })
    if (turn.assistant) lines.push({ itemId: turn.assistant.itemId, role: 'assistant', text: turn.assistant.text })
  }
  return lines
}

function trimLines(lines: ChatMemoryIndexRecord['lines'], maxChars: number): ChatMemoryIndexRecord['lines'] {
  let used = 0
  const kept: ChatMemoryIndexRecord['lines'] = []
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!
    const cost = line.text.length + 1
    if (used + cost > maxChars) continue
    kept.unshift(line)
    used += cost
  }
  return kept
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

function recencyFactor(ageMs: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0) return 1
  return Math.exp(-(ageMs / (halfLifeDays * MS_PER_DAY)) * LN2)
}

/** Derived global spine index for cross-chat phrase lookup; provider stores stay authoritative. */
export class ChatMemoryIndex {
  private manifest: ChatMemoryIndexManifest = {
    version: CHAT_MEMORY_INDEX_VERSION,
    chatIds: [],
    updatedAt: 0
  }
  private readonly records = new Map<string, ChatMemoryIndexRecord>()
  private writeTimer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  private loaded = false

  constructor(
    private readonly dir: string | null,
    private readonly settings: () => ChatMemoryIndexSettings
  ) {}

  static inMemory(settings: ChatMemoryIndexSettings, records: ChatMemoryIndexRecord[] = []): ChatMemoryIndex {
    const index = new ChatMemoryIndex(null, () => settings)
    index.loaded = true
    for (const record of records) {
      index.records.set(record.chatId, record)
      if (!index.manifest.chatIds.includes(record.chatId)) index.manifest.chatIds.push(record.chatId)
    }
    index.sortManifest()
    return index
  }

  async load(): Promise<void> {
    if (this.loaded || !this.dir) {
      this.loaded = true
      return
    }
    await mkdir(this.dir, { recursive: true })
    try {
      const raw = await readFile(join(this.dir, 'manifest.json'), 'utf8')
      const parsed = JSON.parse(raw) as ChatMemoryIndexManifest
      if (parsed?.version === CHAT_MEMORY_INDEX_VERSION && Array.isArray(parsed.chatIds)) {
        this.manifest = parsed
      }
    } catch {
      // Fresh index.
    }
    for (const chatId of [...this.manifest.chatIds]) {
      const record = await this.readRecord(chatId)
      if (record) this.records.set(chatId, record)
      else this.manifest.chatIds = this.manifest.chatIds.filter((id) => id !== chatId)
    }
    this.loaded = true
  }

  upsert(record: ChatRecord, items: ChatTranscriptItem[]): void {
    if (!this.settings().chatMemoryIndexEnabled || record.archived) {
      this.drop(record.id)
      return
    }
    if (!items.length) return
    const maxChars = this.settings().chatMemoryIndexMaxCharsPerChat
    const entry: ChatMemoryIndexRecord = {
      version: CHAT_MEMORY_INDEX_VERSION,
      chatId: record.id,
      cwd: record.cwd,
      title: record.title,
      lastActivityAt: indexActivity(record),
      pinnedAt: record.pinnedAt,
      changedFiles: conversationSpineChangedFiles(items),
      lines: chatIndexLinesFromTranscript(items, maxChars),
      updatedAt: Date.now()
    }
    this.records.set(record.id, entry)
    this.manifest.chatIds = [record.id, ...this.manifest.chatIds.filter((id) => id !== record.id)]
    this.sortManifest()
    this.evict()
    this.scheduleWrite()
  }

  drop(chatId: string): void {
    if (!this.records.has(chatId) && !this.manifest.chatIds.includes(chatId)) return
    this.records.delete(chatId)
    this.manifest.chatIds = this.manifest.chatIds.filter((id) => id !== chatId)
    this.scheduleWrite()
    if (this.dir) void unlink(join(this.dir, `${sanitizeChatFileName(chatId)}.json`)).catch(() => {})
  }

  /** Remove index rows for chats gone from the store or archived. */
  sync(records: Iterable<ChatRecord>): void {
    const live = new Map<string, ChatRecord>()
    for (const record of records) {
      if (!record.archived) live.set(record.id, record)
    }
    for (const chatId of [...this.manifest.chatIds]) {
      if (!live.has(chatId)) this.drop(chatId)
    }
  }

  getRecord(chatId: string): ChatMemoryIndexRecord | undefined {
    return this.records.get(chatId)
  }

  search(request: ChatIndexSearchRequest, excludeChatId?: string | null, resolveChat?: (id: string) => ChatRecord | undefined): ChatIndexSearchResult {
    const settings = this.settings()
    const maxChats = settings.chatMemoryIndexMaxChats
    const empty: ChatIndexSearchResult = {
      hits: [],
      indexedChatCount: this.manifest.chatIds.length,
      maxChats,
      scope: 'global',
      trust: 'historical-data'
    }
    if (!settings.chatMemoryIndexEnabled) return empty
    const query = prepareTextQuery(request.query)
    if (!query) return empty
    const cwd = request.cwd?.trim()
    const limit = Math.max(1, Math.min(SEARCH_MAX_LIMIT, Math.floor(request.limit ?? SEARCH_DEFAULT_LIMIT)))
    const now = Date.now()
    const halfLife = settings.chatMemoryIndexHalfLifeDays
    const scan = (fuzzy: boolean): ChatIndexSearchHit[] => {
      const candidates: ChatIndexSearchHit[] = []
      for (const chatId of this.manifest.chatIds) {
        if (excludeChatId && chatId === excludeChatId) continue
        const record = this.records.get(chatId)
        if (!record) continue
        const chat = resolveChat?.(chatId)
        if (resolveChat && (!chat || chat.archived)) continue
        if (cwd && record.cwd !== cwd) continue
        const recency = recencyFactor(now - record.lastActivityAt, halfLife)
        const pinBoost = record.pinnedAt ? 1.25 : 1
        for (const line of record.lines) {
          const match = matchText(query, line.text, { fuzzy })
          if (!match) continue
          const snippet = clip(line.text.slice(Math.max(0, match.start - 80), match.start + SEARCH_SNIPPET_CHARS), SEARCH_SNIPPET_CHARS)
          const lengthRatio = query.phrase.length / Math.max(line.text.length, query.phrase.length)
          candidates.push({
            ...(resolveChat ? { evidenceAvailability: cachedChatThreadId(chat)
              ? { status: 'not-checked' as const }
              : { status: 'unavailable' as const, reason: 'missing-thread' as const } } : {}),
            chatId: record.chatId,
            itemId: line.itemId,
            role: line.role,
            snippet,
            ...matchLabel(match, line.text),
            score: recency * pinBoost * match.quality * (0.5 + lengthRatio),
            lastActivityAt: record.lastActivityAt,
            cwd: record.cwd,
            title: record.title
          })
        }
      }
      return candidates
    }
    // Typo-tolerant matches only fill in when nothing matches exactly or up to spacing and punctuation.
    const exact = scan(false)
    const candidates = exact.length ? exact : scan(true)
    candidates.sort((a, b) => b.score - a.score || b.lastActivityAt - a.lastActivityAt || a.chatId.localeCompare(b.chatId))
    return { ...empty, hits: candidates.slice(0, limit) }
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    await this.writing
    await this.persist()
  }

  private sortManifest(): void {
    this.manifest.chatIds.sort((a, b) => {
      const left = this.records.get(a)?.lastActivityAt ?? 0
      const right = this.records.get(b)?.lastActivityAt ?? 0
      return right - left || a.localeCompare(b)
    })
  }

  private evict(): void {
    const cap = Math.max(1, Math.min(MAX_CHAT_MEMORY_INDEX_MAX_CHATS, this.settings().chatMemoryIndexMaxChats))
    while (this.manifest.chatIds.length > cap) {
      const chatId = this.manifest.chatIds.at(-1)!
      this.drop(chatId)
    }
  }

  private async readRecord(chatId: string): Promise<ChatMemoryIndexRecord | null> {
    if (!this.dir) return this.records.get(chatId) ?? null
    try {
      const raw = await readFile(join(this.dir, `${sanitizeChatFileName(chatId)}.json`), 'utf8')
      const parsed = JSON.parse(raw) as ChatMemoryIndexRecord
      if (parsed?.version !== CHAT_MEMORY_INDEX_VERSION || parsed.chatId !== chatId) return null
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
      this.writing = this.writing.then(() => this.persist())
    }, WRITE_DELAY_MS)
  }

  private async persist(): Promise<void> {
    if (!this.dir) return
    await mkdir(this.dir, { recursive: true })
    this.manifest.updatedAt = Date.now()
    await writeAtomic(join(this.dir, 'manifest.json'), JSON.stringify(this.manifest))
    const keep = new Set(this.manifest.chatIds)
    for (const chatId of keep) {
      const record = this.records.get(chatId)
      if (!record) continue
      await writeAtomic(join(this.dir, `${sanitizeChatFileName(chatId)}.json`), JSON.stringify(record))
    }
    try {
      const names = await readdir(this.dir)
      for (const name of names) {
        if (!name.endsWith('.json') || name === 'manifest.json') continue
        const chatId = name.slice(0, -5)
        const still = [...keep].some((id) => sanitizeChatFileName(id) === chatId)
        if (!still) await unlink(join(this.dir, name)).catch(() => {})
      }
    } catch {
      // Best-effort orphan cleanup.
    }
  }
}

export function normalizeChatMemoryIndexMaxChats(value: unknown, fallback = DEFAULT_CHAT_MEMORY_INDEX_MAX_CHATS): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(MAX_CHAT_MEMORY_INDEX_MAX_CHATS, Math.floor(value)))
}

export function normalizeChatMemoryIndexHalfLifeDays(value: unknown, fallback = DEFAULT_CHAT_MEMORY_INDEX_HALF_LIFE_DAYS): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(90, Math.floor(value)))
}

export function normalizeChatMemoryIndexMaxCharsPerChat(
  value: unknown,
  fallback = DEFAULT_CHAT_MEMORY_INDEX_MAX_CHARS_PER_CHAT
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(4_000, Math.min(200_000, Math.floor(value)))
}
