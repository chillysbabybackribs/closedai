import type { ChatSpineRequest, ChatSpineResult, ChatSpineTurn } from '../../shared/chat-memory.js'
import type { ConversationSpineTurn } from './conversation-spine.js'
import { conversationSpineTurns } from './conversation-spine.js'
import { conversationSpineChangedFiles } from './thread-handoff.js'

const MAX_SPINE_CHARS = 16_000
const SPINE_DEFAULT_LIMIT = 5
const SPINE_MAX_LIMIT = 8
const MAX_EVIDENCE_PER_TURN = 3
const OMITTED_ANSWER = '[Older answer omitted'

export type SpineTranscriptMeta = {
  threadId: string | null
  title: string | null
  cwd: string
  lastActivityAt: number
  chatId?: string
  provenance: ChatSpineResult['provenance']
}

export function spineTranscript(
  items: import('../../shared/chat.js').ChatTranscriptItem[],
  meta: SpineTranscriptMeta,
  request: ChatSpineRequest
): ChatSpineResult {
  const turns = conversationSpineTurns(items)
  const changedFiles = request.includeChangedFiles === false ? undefined : conversationSpineChangedFiles(items)
  return spineFromTurns(turns, meta, request, changedFiles)
}

export function spineFromTurns(
  turns: ConversationSpineTurn[],
  meta: SpineTranscriptMeta,
  request: ChatSpineRequest,
  changedFiles?: string[]
): ChatSpineResult {
  const limit = Math.max(1, Math.min(SPINE_MAX_LIMIT, Math.floor(request.limit ?? SPINE_DEFAULT_LIMIT)))
  const includeEvidence = request.includeEvidence === true
  let end = turns.length
  if (request.beforeUserItemId) {
    const index = turns.findIndex((turn) => turn.userItemId === request.beforeUserItemId)
    if (index < 0) throw new Error('Spine cursor is outside the available conversation')
    end = index
  }
  const slice = turns.slice(Math.max(0, end - limit), end)
  const page = fitSpineBudget(slice.map((turn) => toPublicTurn(turn, includeEvidence)), meta, changedFiles)
  // Turns the budget dropped sit just before the first kept one, so the cursor names that turn and
  // the next page starts with them instead of skipping past.
  const hasMore = end - limit > 0 || page.length < slice.length
  const nextBeforeUserItemId = hasMore ? page[0]?.userItemId ?? null : null
  return {
    ...(meta.chatId ? { chatId: meta.chatId } : {}),
    threadId: meta.threadId,
    title: meta.title,
    cwd: meta.cwd,
    lastActivityAt: meta.lastActivityAt,
    ...(changedFiles !== undefined ? { changedFiles } : {}),
    turns: page,
    hasMore,
    nextBeforeUserItemId,
    provenance: meta.provenance,
    trust: 'historical-data'
  }
}

function toPublicTurn(turn: ConversationSpineTurn, includeEvidence: boolean): ChatSpineTurn {
  const result: ChatSpineTurn = { userItemId: turn.userItemId, user: turn.userText }
  if (turn.assistant) result.assistant = { ...turn.assistant }
  if (turn.plan) result.plan = { ...turn.plan }
  if (includeEvidence && turn.evidence.length) {
    result.evidence = turn.evidence.slice(-MAX_EVIDENCE_PER_TURN).map((entry) => ({ ...entry }))
  }
  return result
}

function fitSpineBudget(
  turns: ChatSpineTurn[],
  meta: SpineTranscriptMeta,
  changedFiles?: string[]
): ChatSpineTurn[] {
  const draft = [...turns]
  const shell = (page: ChatSpineTurn[]) => JSON.stringify({
    ...(meta.chatId ? { chatId: meta.chatId } : {}),
    threadId: meta.threadId,
    title: meta.title,
    cwd: meta.cwd,
    lastActivityAt: meta.lastActivityAt,
    ...(changedFiles !== undefined ? { changedFiles } : {}),
    turns: page,
    hasMore: false,
    nextBeforeUserItemId: null,
    provenance: meta.provenance,
    trust: 'historical-data'
  }).length
  // Older answers become recall pointers first, oldest first; only then do whole turns go, oldest
  // first, never the newest one, so every page moves the cursor.
  for (const turn of draft) {
    if (shell(draft) <= MAX_SPINE_CHARS) break
    if (!turn.assistant || turn.assistant.text.startsWith(OMITTED_ANSWER)) continue
    turn.assistant = {
      itemId: turn.assistant.itemId,
      text: `${OMITTED_ANSWER}; recall item_id=${JSON.stringify(turn.assistant.itemId)}]`
    }
  }
  while (shell(draft) > MAX_SPINE_CHARS && draft.length > 1) draft.shift()
  return draft
}
