import { randomUUID } from 'node:crypto'
import {
  bareChatId,
  CHAT_PROVIDER_ID_PREFIXES,
  CHAT_PROVIDER_TURN_PREFIXES,
  isChatIdOf,
  prefixChatId
} from '../../shared/chat-providers.js'

// Antigravity models and threads share the chat surface with Codex and Claude ones, so both
// carry an `agy:` prefix that lets the hub route an id without asking any provider. A model
// id names a model family (`agy:gemini-3.8-flash`); the effort picker chooses the CLI's
// effort-suffixed wire name. A thread id wraps the CLI's conversation id. The prefix and the
// arithmetic around it live in the shared provider registry; this file only names those
// operations in Antigravity's vocabulary.

export const ANTIGRAVITY_ID_PREFIX = CHAT_PROVIDER_ID_PREFIXES.antigravity

/** The composer id for a model family, e.g. `agy:gemini-3.8-flash`. */
export function antigravityModelId(family: string): string {
  return prefixChatId('antigravity', family)
}

export function isAntigravityId(id: string | null | undefined): id is string {
  return isChatIdOf('antigravity', id)
}

/** The model family behind a composer id, or null for a non-Antigravity id. */
export function antigravityModelFamily(id: string | null | undefined): string | null {
  return bareChatId('antigravity', id)
}

/** The chat thread id for a CLI conversation id. */
export function antigravityThreadId(conversationId: string): string {
  return prefixChatId('antigravity', conversationId)
}

/** The CLI conversation id behind a chat thread id, or null for a non-Antigravity thread. */
export function antigravityConversationIdOf(threadId: string | null | undefined): string | null {
  return antigravityModelFamily(threadId)
}

/** A fresh turn id. The prefix is what routes a trace entry back to this provider. */
export function antigravityTurnId(): string {
  return `${CHAT_PROVIDER_TURN_PREFIXES.antigravity}${randomUUID()}`
}
