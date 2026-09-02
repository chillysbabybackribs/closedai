export const DRAWER_REVIEW_QUEUE_STORAGE_KEY = 'closedai.drawer.reviewQueue'

export type DrawerReviewQueue = Record<string, number>

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

export function readDrawerReviewQueue(storage: StorageReader): DrawerReviewQueue {
  try {
    const raw = storage.getItem(DRAWER_REVIEW_QUEUE_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const entries = Object.entries(parsed).filter(
      (entry): entry is [string, number] =>
        entry[0].length > 0 &&
        typeof entry[1] === 'number' &&
        Number.isFinite(entry[1]) &&
        entry[1] >= 0
    )
    return Object.fromEntries(entries)
  } catch {
    return {}
  }
}

export function persistDrawerReviewQueue(storage: StorageWriter, queue: DrawerReviewQueue): void {
  try {
    storage.setItem(DRAWER_REVIEW_QUEUE_STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // Suppress storage errors
  }
}

export function enqueueDrawerReview(
  current: DrawerReviewQueue,
  id: string,
  queuedAt: number
): DrawerReviewQueue {
  if (!id) return current
  if (current[id] !== undefined) return current
  return { ...current, [id]: queuedAt }
}

export function dequeueDrawerReview(current: DrawerReviewQueue, id: string): DrawerReviewQueue {
  if (!(id in current)) return current
  const next = { ...current }
  delete next[id]
  return next
}

export function countDrawerReviewQueue(queue: DrawerReviewQueue): number {
  return Object.keys(queue).length
}
