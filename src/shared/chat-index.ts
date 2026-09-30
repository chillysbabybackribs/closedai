import type { ChatEvidenceAvailability } from './chat-memory.js'

export const CHAT_MEMORY_INDEX_VERSION = 1 as const
export const CHAT_PANE_LEXICAL_INDEX_VERSION = 1 as const

/** Per-pane merged transcript index; not subject to the global hot-index chat cap. */
export const DEFAULT_CHAT_PANE_LEXICAL_MAX_CHARS = 96_000

/** Default hot index size: recent cross-chat phrase search, not full history. */
export const DEFAULT_CHAT_MEMORY_INDEX_MAX_CHATS = 10
export const MAX_CHAT_MEMORY_INDEX_MAX_CHATS = 100

export const DEFAULT_CHAT_MEMORY_INDEX_HALF_LIFE_DAYS = 7
export const DEFAULT_CHAT_MEMORY_INDEX_MAX_CHARS_PER_CHAT = 48_000

export type ChatIndexLine = {
  itemId: string
  role: 'user' | 'assistant' | 'plan' | 'evidence'
  text: string
}

export type ChatMemoryIndexRecord = {
  version: typeof CHAT_MEMORY_INDEX_VERSION
  chatId: string
  cwd: string
  title: string | null
  lastActivityAt: number
  pinnedAt: number | null
  changedFiles: string[]
  lines: ChatIndexLine[]
  updatedAt: number
}

export type ChatMemoryIndexManifest = {
  version: typeof CHAT_MEMORY_INDEX_VERSION
  /** Chat ids retained in the hot index, most recently active first. */
  chatIds: string[]
  updatedAt: number
}

export type ChatIndexSearchScope = 'global' | 'chat'

export type ChatIndexSearchRequest = {
  query?: string
  /** global (default): cross-chat hot index. chat: caller pane merged transcript only. */
  scope?: ChatIndexSearchScope
  /** Optional project directory filter; the index itself stays global. */
  cwd?: string
  limit?: number
}

export type ChatPaneLexicalIndexRecord = {
  version: typeof CHAT_PANE_LEXICAL_INDEX_VERSION
  chatId: string
  cwd: string
  title: string | null
  lastActivityAt: number
  rotationEpoch: number
  partial: boolean
  lines: ChatIndexLine[]
  updatedAt: number
}

export type ChatIndexSearchHit = {
  evidenceAvailability?: ChatEvidenceAvailability
  chatId: string
  itemId: string
  role: ChatIndexLine['role']
  snippet: string
  score: number
  lastActivityAt: number
  cwd: string
  title: string | null
}

export type ChatIndexSearchResult = {
  hits: ChatIndexSearchHit[]
  indexedChatCount: number
  maxChats: number
  scope: ChatIndexSearchScope
  /** Latest session rotation epoch when scope is chat. */
  rotationEpoch?: number
  /** True when prerotation merge failed but rotations exist. */
  indexPartial?: boolean
  trust: 'historical-data'
}
