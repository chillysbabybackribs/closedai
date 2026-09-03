import type { ChatMemoryCheckpoint, ChatMemoryState } from '../../shared/chat-memory.js'

export const MAX_CHECKPOINT_CHARS = 6_000
const LIST_FIELDS = ['constraints', 'decisions', 'progress', 'nextSteps', 'files'] as const

/** Reject oversized memory rather than silently dropping a potentially important constraint. */
export function validateMemoryState(value: unknown): ChatMemoryState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Checkpoint state must be an object')
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== 'goal' && !LIST_FIELDS.includes(key as typeof LIST_FIELDS[number]))) {
    throw new Error('Unknown checkpoint field')
  }
  if (typeof record.goal !== 'string' || !record.goal.trim() || record.goal.length > 1_000) throw new Error('Goal must contain 1–1,000 characters')
  const state = { goal: record.goal.trim() } as ChatMemoryState
  for (const field of LIST_FIELDS) {
    const values = record[field]
    if (!Array.isArray(values) || values.length > 12 || values.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.length > 400)) {
      throw new Error(`${field} must contain at most 12 non-empty strings of at most 400 characters`)
    }
    state[field] = [...new Set(values.map((entry: string) => entry.trim()))]
  }
  if (JSON.stringify(state).length > MAX_CHECKPOINT_CHARS) throw new Error(`Checkpoint exceeds ${MAX_CHECKPOINT_CHARS} serialized characters; condense it before saving`)
  return state
}

/** Persisted memory is untrusted input too. Invalid/old formats cannot enter a handoff. */
export function normalizeMemoryCheckpoint(value: unknown): ChatMemoryCheckpoint | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.version !== 1 || !Number.isSafeInteger(record.revision) || Number(record.revision) < 1
    || typeof record.threadId !== 'string' || !record.threadId || record.threadId.length > 256
    || typeof record.throughItemId !== 'string' || !record.throughItemId || record.throughItemId.length > 256
    || typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt) || record.createdAt < 0) return null
  try {
    return { version: 1, revision: Number(record.revision), threadId: record.threadId,
      throughItemId: record.throughItemId, createdAt: record.createdAt, state: validateMemoryState(record.state) }
  } catch {
    return null
  }
}
