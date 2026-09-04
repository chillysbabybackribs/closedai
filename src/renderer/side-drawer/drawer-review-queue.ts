export const DRAWER_REVIEW_QUEUE_STORAGE_KEY = 'closedai.drawer.reviewQueue'
export const DRAWER_REVIEW_RETENTION_MS = 10 * 60 * 1000

export type DrawerReviewEntry = {
  /** When the pane's most recent turn finished. */
  queuedAt: number
  /** When the user first opened the completed pane. Unreviewed entries do not expire. */
  viewedAt: number | null
}

/**
 * Keyed by chat id — the store's stable id, which is also the pane id while the chat is attached.
 * Persisted so a relaunch keeps unreviewed work in the queue: an unviewed entry never expires, a
 * viewed one ages out after the grace period.
 */
export type DrawerReviewQueue = Record<string, DrawerReviewEntry>

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

export function readDrawerReviewQueue(storage: StorageReader): DrawerReviewQueue {
  try {
    const raw = storage.getItem(DRAWER_REVIEW_QUEUE_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const queue: DrawerReviewQueue = {}
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
function normalizeEntry(value: unknown): DrawerReviewEntry | null {
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

export function persistDrawerReviewQueue(storage: StorageWriter, queue: DrawerReviewQueue): void {
  try {
    storage.setItem(DRAWER_REVIEW_QUEUE_STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // Suppress storage errors
  }
}

export function enqueueDrawerReview(current: DrawerReviewQueue, id: string, queuedAt: number): DrawerReviewQueue {
  if (!id || current[id] !== undefined) return current
  return { ...current, [id]: { queuedAt, viewedAt: null } }
}

export function dequeueDrawerReview(current: DrawerReviewQueue, id: string): DrawerReviewQueue {
  if (!(id in current)) return current
  const next = { ...current }
  delete next[id]
  return next
}

export function markDrawerReviewViewed(
  current: DrawerReviewQueue,
  id: string,
  viewedAt: number = Date.now()
): DrawerReviewQueue {
  const entry = current[id]
  if (!entry || entry.viewedAt !== null) return current
  return { ...current, [id]: { ...entry, viewedAt } }
}

/** Reviewed completions age into History; unread completions remain until the user opens them. */
export function expireDrawerReviews(
  current: DrawerReviewQueue,
  now: number,
  retentionMs: number = DRAWER_REVIEW_RETENTION_MS
): DrawerReviewQueue {
  const expired = Object.entries(current)
    .filter(([, entry]) => entry.viewedAt !== null && now - entry.viewedAt >= retentionMs)
    .map(([id]) => id)
  if (expired.length === 0) return current
  const next = { ...current }
  for (const id of expired) delete next[id]
  return next
}

export function nextDrawerReviewExpiry(queue: DrawerReviewQueue): number | null {
  let next: number | null = null
  for (const entry of Object.values(queue)) {
    if (entry.viewedAt === null) continue
    const expiresAt = entry.viewedAt + DRAWER_REVIEW_RETENTION_MS
    if (next === null || expiresAt < next) next = expiresAt
  }
  return next
}

/**
 * Drop entries whose chat the store no longer lists — archived, or from a stale store. Detaching
 * a pane is not that: the record stays, and so does its place in the queue.
 */
export function pruneDrawerReviewQueue(current: DrawerReviewQueue, knownChatIds: ReadonlySet<string>): DrawerReviewQueue {
  const stale = Object.keys(current).filter((id) => !knownChatIds.has(id))
  if (stale.length === 0) return current
  const next = { ...current }
  for (const id of stale) delete next[id]
  return next
}

export function countDrawerReviewQueue(queue: DrawerReviewQueue): number {
  return Object.keys(queue).length
}
