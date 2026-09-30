import type { ChatSpineRequest, ChatSpineResult, ChatSpineTurn } from '../../shared/chat-memory.js'
import type { ConversationSpineTurn } from './conversation-spine.js'
import { conversationSpineTurns } from './conversation-spine.js'
import { conversationSpineChangedFiles } from './thread-handoff.js'

const MAX_SPINE_CHARS = 16_000
const SPINE_DEFAULT_LIMIT = 5
const SPINE_MAX_LIMIT = 8
const MAX_EVIDENCE_PER_TURN = 3

export type SpineTranscriptMeta = {
  threadId: string
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
  const hasMore = end - limit > 0
  const nextBeforeUserItemId = hasMore ? slice[0]?.userItemId ?? null : null
  let page = slice.map((turn) => toPublicTurn(turn, includeEvidence))
  page = fitSpineBudget(page, meta, changedFiles)
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
  while (shell(draft) > MAX_SPINE_CHARS && draft.length > 0) {
    const oldest = draft[0]!
    if (oldest.assistant) {
      oldest.assistant = {
        itemId: oldest.assistant.itemId,
        text: `[Older answer omitted; recall item_id=${JSON.stringify(oldest.assistant.itemId)}]`
      }
      if (shell(draft) <= MAX_SPINE_CHARS) break
    }
    draft.shift()
  }
  while (shell(draft) > MAX_SPINE_CHARS && draft.length > 0) {
    const target = draft.find((turn) => turn.assistant && !turn.assistant.text.startsWith('[Older answer omitted'))
    if (!target?.assistant) break
    target.assistant = {
      itemId: target.assistant.itemId,
      text: `[Older answer omitted; recall item_id=${JSON.stringify(target.assistant.itemId)}]`
    }
  }
  return draft
}
