export const AGENT_REVIEW_QUEUE_STORAGE_KEY = 'closedai.agents.reviewQueue'

export type AgentReviewQueue = Record<string, number>

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

export function readAgentReviewQueue(storage: StorageReader): AgentReviewQueue {
  try {
    const raw = storage.getItem(AGENT_REVIEW_QUEUE_STORAGE_KEY)
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

export function persistAgentReviewQueue(storage: StorageWriter, queue: AgentReviewQueue): void {
  try {
    storage.setItem(AGENT_REVIEW_QUEUE_STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // Storage access failures must not break UI flow
  }
}

export function enqueueAgentReview(
  current: AgentReviewQueue,
  id: string,
  queuedAt: number
): AgentReviewQueue {
  if (!id) return current
  if (current[id] !== undefined) return current
  return { ...current, [id]: queuedAt }
}

export function dequeueAgentReview(current: AgentReviewQueue, id: string): AgentReviewQueue {
  if (!(id in current)) return current
  const next = { ...current }
  delete next[id]
  return next
}

export function countAgentReviewQueue(queue: AgentReviewQueue): number {
  return Object.keys(queue).length
}
