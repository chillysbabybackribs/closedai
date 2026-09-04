import type { ChatTranscriptItem } from '../../shared/chat.js'
import type { ChatMemoryCheckpoint, ChatRecallRequest, ChatRecallResult } from '../../shared/chat-memory.js'

const MAX_RECALL_CHARS = 16_000
const EXCERPT_CHARS = 800

/** Search a stable transcript prefix, returning small excerpts and exact-message continuation. */
export function recallTranscript(
  items: ChatTranscriptItem[], threadId: string, checkpoint: ChatMemoryCheckpoint | null,
  request: ChatRecallRequest, throughItemId: string | null
): ChatRecallResult {
  let end = items.length
  if (throughItemId) {
    end = items.findIndex((item) => item.id === throughItemId) + 1
    if (end === 0) throw new Error('The saved source boundary is unavailable; refusing to read beyond it')
  }
  if (checkpoint) {
    const anchor = checkpoint.throughItemId
    const index = items.findIndex((item) => item.id === anchor)
    // Current-thread notes survive native compaction removing their old anchor. A source
    // checkpoint, however, must still prove it precedes the frozen continuation boundary.
    if (checkpoint.threadId !== threadId || (throughItemId && (index < 0 || index >= end))) checkpoint = null
  }
  if (request.beforeItemId) {
    const index = items.findIndex((item) => item.id === request.beforeItemId)
    if (index < 0 || index >= end) throw new Error('Recall cursor is outside the available history')
    end = index
  }
  const limit = Math.max(1, Math.min(8, Math.floor(request.limit ?? 5)))
  const query = request.query?.trim().toLowerCase() ?? ''
  // Tool calls outnumber messages in a working thread, so an unfiltered recall spends its excerpts
  // echoing the caller's own tool JSON back at it. `types` asks the question that was meant.
  const types = request.types?.length ? new Set<string>(request.types) : null
  const result: ChatRecallResult = {
    threadId, checkpoint, matches: [], hasMore: false, nextBeforeItemId: null,
    throughItemId, trust: 'historical-data'
  }
  for (let index = end - 1; index >= 0; index--) {
    const item = items[index]!
    if (item.id.length > 256) continue
    if (request.itemId && item.id !== request.itemId) continue
    if (types && !types.has(item.type)) continue
    const text = recallText(item)
    if (text === null) continue
    const match = query ? text.toLowerCase().indexOf(query) : 0
    if (match < 0) continue
    const offset = request.itemId ? Math.max(0, Math.floor(request.offset ?? 0)) : Math.max(0, match - 160)
    const excerpt = text.slice(offset, offset + EXCERPT_CHARS)
    const entry = {
      itemId: item.id, turnId: item.turnId, role: item.type, text: excerpt, offset,
      nextOffset: offset + excerpt.length < text.length ? offset + excerpt.length : null
    }
    // Budget the serialized transport too: quotes/control characters can expand substantially.
    const serializedSize = () => JSON.stringify({ ...result, matches: [...result.matches, entry], nextBeforeItemId: item.id }).length
    while (serializedSize() > MAX_RECALL_CHARS && entry.text.length > 32) {
      entry.text = entry.text.slice(0, Math.floor(entry.text.length / 2))
      entry.nextOffset = offset + entry.text.length
    }
    if (serializedSize() > MAX_RECALL_CHARS) {
      result.hasMore = true
      result.nextBeforeItemId = result.matches.at(-1)?.itemId ?? null
      break
    }
    result.matches.push(entry)
    if (request.itemId) break
    if (result.matches.length >= limit) {
      result.hasMore = index > 0
      result.nextBeforeItemId = result.hasMore ? item.id : null
      break
    }
  }
  return result
}

/** Exclude screenshot and reasoning items; include only bounded excerpts of textual work. */
function recallText(item: ChatTranscriptItem): string | null {
  switch (item.type) {
    case 'user':
    case 'assistant':
    case 'plan': return item.text
    case 'command': return `${item.command}\n${item.output}`
    case 'tool': return `${item.label}\n${item.detail}\n${item.output ?? ''}`
    case 'fileChange': return item.changes.map((change) => `${change.path}\n${change.diff ?? ''}`).join('\n')
    default: return null
  }
}
