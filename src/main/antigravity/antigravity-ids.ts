// Antigravity models and threads share the chat surface with Codex and Claude ones, so both
// carry an `agy:` prefix that lets the hub route an id without asking any provider. A model
// id names a model family (`agy:gemini-3.8-flash`); the effort picker chooses the CLI's
// effort-suffixed wire name. A thread id wraps the CLI's conversation id.

export const ANTIGRAVITY_ID_PREFIX = 'agy:'

/** The composer id for a model family, e.g. `agy:gemini-3.8-flash`. */
export function antigravityModelId(family: string): string {
  return `${ANTIGRAVITY_ID_PREFIX}${family}`
}

export function isAntigravityId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.startsWith(ANTIGRAVITY_ID_PREFIX) && id.length > ANTIGRAVITY_ID_PREFIX.length
}

/** The model family behind a composer id, or null for a non-Antigravity id. */
export function antigravityModelFamily(id: string | null | undefined): string | null {
  return isAntigravityId(id) ? id.slice(ANTIGRAVITY_ID_PREFIX.length) : null
}

/** The chat thread id for a CLI conversation id. */
export function antigravityThreadId(conversationId: string): string {
  return `${ANTIGRAVITY_ID_PREFIX}${conversationId}`
}

/** The CLI conversation id behind a chat thread id, or null for a non-Antigravity thread. */
export function antigravityConversationIdOf(threadId: string | null | undefined): string | null {
  return antigravityModelFamily(threadId)
}
