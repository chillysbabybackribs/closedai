import type { ChatProvider } from './chat.js'
import type { ChatMemoryCheckpoint } from './chat-memory.js'
import { prefixChatId } from './chat-providers.js'
import type { ChatContinuation } from './types.js'

// The app's own record of a chat. A chat used to exist only as a live pane (discarded when empty,
// retired past the open-pane cap, minted afresh on every history open) or as a provider thread
// scraped from that provider's store, so it changed identity every time it crossed a drawer
// section. This record outlives both: its id is the pane id while the chat is attached, the key
// the drawer's completion marks use, and the name a relaunch finds it under.

export type ChatRecord = {
  /** Stable for the chat's whole life; equal to the pane id whenever the chat is attached. */
  id: string
  cwd: string
  projectPath: string | null
  provider: ChatProvider
  modelId: string | null
  reasoningEffort: string | null
  codexThreadId: string | null
  claudeSessionId: string | null
  antigravityConversationId: string | null
  cursorSessionId: string | null
  /** The active provider's thread in its prefixed form; derived from the ids above. */
  threadId: string | null
  /** Last known display title; null until the chat has one. */
  title: string | null
  /** Last transcript line, bounded, for the drawer row. */
  preview: string
  createdAt: number
  updatedAt: number
  /** When the most recent turn finished; null until a turn has completed. */
  lastTurnEndedAt: number | null
  archived: boolean
  /** Sidebar pin time, independent of conversation activity; null when unpinned. */
  pinnedAt: number | null
  /** The chat this one continued from, including a restart-safe one-shot digest. */
  continuation: ChatContinuation | null
  /** One bounded checkpoint; usable only for its recorded provider thread. */
  checkpoint: ChatMemoryCheckpoint | null
  /** The chat that fanned this one out, when a tool created it; null for user-created chats. */
  parentChatId: string | null
}

export type ChatRecordSeed = Pick<ChatRecord, 'cwd' | 'projectPath' | 'provider' | 'modelId' | 'reasoningEffort'> &
  Partial<Omit<ChatRecord, 'cwd' | 'projectPath' | 'provider' | 'modelId' | 'reasoningEffort'>>

/** Fields a `ChatRecord` patch may carry; identity and creation time never change. */
export type ChatRecordPatch = Partial<Omit<ChatRecord, 'id' | 'createdAt' | 'cwd' | 'projectPath' | 'threadId'>>

/** The persisted file: every chat the app has shown, across workspaces. */
export type ChatStoreFile = {
  version: 1
  chats: ChatRecord[]
}

export type ChatProviderThreadIds = Pick<ChatRecord, 'codexThreadId' | 'claudeSessionId' | 'antigravityConversationId' | 'cursorSessionId'>

/** The chat's displayed thread id: the active provider's thread, in that provider's prefixed form. */
export function chatRecordThreadId(provider: ChatProvider, ids: ChatProviderThreadIds): string | null {
  if (provider === 'claude') return ids.claudeSessionId ? prefixChatId(provider, ids.claudeSessionId) : null
  if (provider === 'antigravity') {
    return ids.antigravityConversationId ? prefixChatId(provider, ids.antigravityConversationId) : null
  }
  if (provider === 'cursor') return ids.cursorSessionId ? prefixChatId(provider, ids.cursorSessionId) : null
  return ids.codexThreadId
}

/** Whether a chat has anything worth keeping: a thread, a title, or a pending continuation. */
export function chatRecordIsBlank(record: Pick<ChatRecord, 'threadId' | 'title' | 'continuation'>): boolean {
  return record.threadId === null && record.title === null && record.continuation === null
}
