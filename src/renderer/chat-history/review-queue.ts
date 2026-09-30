export const CHAT_REVIEW_QUEUE_STORAGE_KEY = 'closedai.drawer.reviewQueue'
export const CHAT_REVIEW_RETENTION_MS = 10 * 60 * 1000

export type ChatReviewEntry = {
  /** When the pane's most recent turn finished. */
  queuedAt: number
  /** When the user opened the completed pane or closed its tab. Unreviewed entries do not expire. */
  viewedAt: number | null
}

/**
 * Keyed by chat id — the store's stable id, which is also the pane id while the chat is attached.
 * Persisted so a relaunch keeps unreviewed work in the queue: an unviewed entry never expires, a
 * viewed one ages out after the grace period.
 */
export type ChatReviewQueue = Record<string, ChatReviewEntry>

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

export function readChatReviewQueue(storage: StorageReader): ChatReviewQueue {
  try {
    const raw = storage.getItem(CHAT_REVIEW_QUEUE_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const queue: ChatReviewQueue = {}
    for (const [id, value] of Object.entries(parsed)) {
      const entry = normalizeEntry(value)
      if (id.length > 0 && entry) queue[id] = entry
    }
    return queue
  } catch {
    return {}
  }
}

/** Earlier builds stored a bare timestamp or a viewed flag. */
function normalizeEntry(value: unknown): ChatReviewEntry | null {
  if (isTime(value)) return { queuedAt: value, viewedAt: null }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!isTime(record.queuedAt)) return null
  const viewedAt = isTime(record.viewedAt)
    ? record.viewedAt
    : record.viewed === true
      ? record.queuedAt
      : null
  return { queuedAt: record.queuedAt, viewedAt }
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function persistChatReviewQueue(storage: StorageWriter, queue: ChatReviewQueue): void {
  try {
    storage.setItem(CHAT_REVIEW_QUEUE_STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // Suppress storage errors
  }
}

export function enqueueChatReview(current: ChatReviewQueue, id: string, queuedAt: number): ChatReviewQueue {
  if (!id || current[id] !== undefined) return current
  return { ...current, [id]: { queuedAt, viewedAt: null } }
}

export function dequeueChatReview(current: ChatReviewQueue, id: string): ChatReviewQueue {
  if (!(id in current)) return current
  const next = { ...current }
  delete next[id]
  return next
}

export function markChatReviewViewed(
  current: ChatReviewQueue,
  id: string,
  viewedAt: number = Date.now()
): ChatReviewQueue {
  const entry = current[id]
  if (!entry || entry.viewedAt !== null) return current
  return { ...current, [id]: { ...entry, viewedAt } }
}

/** Reviewed completions age into History; unread completions remain until the user opens them. */
export function expireChatReviews(
  current: ChatReviewQueue,
  now: number,
  retentionMs: number = CHAT_REVIEW_RETENTION_MS
): ChatReviewQueue {
  const expired = Object.entries(current)
    .filter(([, entry]) => entry.viewedAt !== null && now - entry.viewedAt >= retentionMs)
    .map(([id]) => id)
  if (expired.length === 0) return current
  const next = { ...current }
  for (const id of expired) delete next[id]
  return next
}

export function nextChatReviewExpiry(queue: ChatReviewQueue): number | null {
  let next: number | null = null
  for (const entry of Object.values(queue)) {
    if (entry.viewedAt === null) continue
    const expiresAt = entry.viewedAt + CHAT_REVIEW_RETENTION_MS
    if (next === null || expiresAt < next) next = expiresAt
  }
  return next
}

/**
 * Drop entries whose chat the store no longer lists — archived, or from a stale store. Detaching
 * a pane is not that: the record stays, and so does its place in the queue.
 */
export function pruneChatReviewQueue(current: ChatReviewQueue, knownChatIds: ReadonlySet<string>): ChatReviewQueue {
  const stale = Object.keys(current).filter((id) => !knownChatIds.has(id))
  if (stale.length === 0) return current
  const next = { ...current }
  for (const id of stale) delete next[id]
  return next
}

export function countChatReviewQueue(queue: ChatReviewQueue): number {
  return Object.keys(queue).length
}
