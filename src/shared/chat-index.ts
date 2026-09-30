export const CHAT_MEMORY_INDEX_VERSION = 1 as const

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

export type ChatIndexSearchRequest = {
  query?: string
  /** Optional project directory filter; the index itself stays global. */
  cwd?: string
  limit?: number
}

export type ChatIndexSearchHit = {
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
  trust: 'historical-data'
}
