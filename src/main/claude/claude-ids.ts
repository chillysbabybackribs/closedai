import { randomUUID } from 'node:crypto'
import {
  bareChatId,
  CHAT_PROVIDER_ID_PREFIXES,
  CHAT_PROVIDER_TURN_PREFIXES,
  isChatIdOf,
  prefixChatId
} from '../../shared/chat-providers.js'

// Claude models and threads share the chat surface with Codex ones, so both carry a prefix
// that lets the hub route an id without asking either provider. Codex ids never contain a
// colon (app-server model names and thread UUIDs), so the prefix cannot collide. The prefix
// itself and the arithmetic around it live in the shared provider registry; this file only
// names those operations in Claude's vocabulary.

export const CLAUDE_ID_PREFIX = CHAT_PROVIDER_ID_PREFIXES.claude

/** The composer id for an SDK model value, e.g. `claude:opus[1m]`. */
export function claudeModelId(value: string): string {
  return prefixChatId('claude', value)
}

export function isClaudeModelId(id: string | null | undefined): id is string {
  return isChatIdOf('claude', id)
}

/** The SDK `model` option value behind a composer id, or null for a non-Claude id. */
export function claudeModelValue(id: string | null | undefined): string | null {
  return bareChatId('claude', id)
}

/** The chat thread id for an SDK session id. */
export function claudeThreadId(sessionId: string): string {
  return prefixChatId('claude', sessionId)
}

export function isClaudeThreadId(id: string | null | undefined): id is string {
  return isClaudeModelId(id)
}

/** The SDK session id behind a chat thread id, or null for a non-Claude thread. */
export function claudeSessionIdOf(threadId: string | null | undefined): string | null {
  return claudeModelValue(threadId)
}

/** A fresh turn id. The prefix is what routes a trace entry back to this provider. */
export function claudeTurnId(): string {
  return `${CHAT_PROVIDER_TURN_PREFIXES.claude}${randomUUID()}`
}
