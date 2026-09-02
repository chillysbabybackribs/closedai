// Claude models and threads share the chat surface with Codex ones, so both carry a prefix
// that lets the hub route an id without asking either provider. Codex ids never contain a
// colon (app-server model names and thread UUIDs), so the prefix cannot collide.

export const CLAUDE_ID_PREFIX = 'claude:'

/** The composer id for an SDK model value, e.g. `claude:opus[1m]`. */
export function claudeModelId(value: string): string {
  return `${CLAUDE_ID_PREFIX}${value}`
}

export function isClaudeModelId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.startsWith(CLAUDE_ID_PREFIX) && id.length > CLAUDE_ID_PREFIX.length
}

/** The SDK `model` option value behind a composer id, or null for a non-Claude id. */
export function claudeModelValue(id: string | null | undefined): string | null {
  return isClaudeModelId(id) ? id.slice(CLAUDE_ID_PREFIX.length) : null
}

/** The chat thread id for an SDK session id. */
export function claudeThreadId(sessionId: string): string {
  return `${CLAUDE_ID_PREFIX}${sessionId}`
}

export function isClaudeThreadId(id: string | null | undefined): id is string {
  return isClaudeModelId(id)
}

/** The SDK session id behind a chat thread id, or null for a non-Claude thread. */
export function claudeSessionIdOf(threadId: string | null | undefined): string | null {
  return claudeModelValue(threadId)
}
