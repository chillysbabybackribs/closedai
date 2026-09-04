import { randomUUID } from 'node:crypto'
import {
  bareChatId,
  CHAT_PROVIDER_ID_PREFIXES,
  CHAT_PROVIDER_TURN_PREFIXES,
  isChatIdOf,
  prefixChatId
} from '../../shared/chat-providers.js'

// Cursor models and threads share the chat surface with the other providers, so both carry a
// `cursor:` prefix that lets the hub route an id without asking any provider. A model id names
// a base model (`cursor:claude-opus-5`); ACP's bracketed parameters (`[effort=high,…]`) are
// rebuilt from the effort picker at send time and never live in the composer id. A thread id
// wraps the ACP session id. The prefix arithmetic lives in the shared provider registry; this
// file only names those operations in Cursor's vocabulary.

export const CURSOR_ID_PREFIX = CHAT_PROVIDER_ID_PREFIXES.cursor

/** The composer id for a base model name, e.g. `cursor:claude-opus-5`. */
export function cursorModelId(base: string): string {
  return prefixChatId('cursor', base)
}

export function isCursorId(id: string | null | undefined): id is string {
  return isChatIdOf('cursor', id)
}

/** The base model name behind a composer id, or null for a non-Cursor id. */
export function cursorModelBase(id: string | null | undefined): string | null {
  return bareChatId('cursor', id)
}

/** The chat thread id for an ACP session id. */
export function cursorThreadId(sessionId: string): string {
  return prefixChatId('cursor', sessionId)
}

/** The ACP session id behind a chat thread id, or null for a non-Cursor thread. */
export function cursorSessionIdOf(threadId: string | null | undefined): string | null {
  return cursorModelBase(threadId)
}

/** A fresh turn id. The prefix is what routes a trace entry back to this provider. */
export function cursorTurnId(): string {
  return `${CHAT_PROVIDER_TURN_PREFIXES.cursor}${randomUUID()}`
}
