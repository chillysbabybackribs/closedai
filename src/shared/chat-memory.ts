/** Availability of source evidence, independent of retained index text. */
export type ChatEvidenceAvailability = {
  status: 'not-checked' | 'unavailable'
  reason?: 'missing-thread' | 'provider-read-failed' | 'item-not-found'
}

/** Model-authored working notes, never authority or proof that an action succeeded. */
export type ChatMemoryState = {
  goal: string
  constraints: string[]
  decisions: string[]
  progress: string[]
  nextSteps: string[]
  files: string[]
}

export type ChatMemoryCheckpoint = {
  version: 1
  revision: number
  threadId: string
  throughItemId: string
  createdAt: number
  state: ChatMemoryState
}

export type ChatRecallRequest = {
  scope: 'current' | 'source' | 'history'
  /** Stable chat id from history discovery; history defaults to the most recent chat. */
  chatId?: string
  /** Item kinds to search; user/assistant messages when omitted or empty. */
  types?: readonly string[]
  query?: string
  itemId?: string
  offset?: number
  limit?: number
  beforeItemId?: string
}

export type ChatHistoryRequest = {
  query?: string
  beforeChatId?: string
  limit?: number
  /** Omit to discover across projects. */
  cwd?: string
}

export type ChatHistoryResult = {
  chats: Array<{
    chatId: string
    threadId: string
    title: string
    preview: string
    cwd: string
    lastActivityAt: number
  }>
  nextBeforeChatId: string | null
  trust: 'historical-data'
}

export type ChatRecallResult = {
  /** Present for history recall, including when the caller used the most-recent default. */
  chatId?: string
  threadId: string | null
  provenance?: 'index' | 'transcript'
  evidenceAvailability?: ChatEvidenceAvailability
  checkpoint: ChatMemoryCheckpoint | null
  matches: Array<{ itemId: string; turnId: string | null; role: string; text: string; offset: number; nextOffset: number | null }>
  hasMore: boolean
  nextBeforeItemId: string | null
  /** The explicit bound used when recalling a continuation's source. */
  throughItemId: string | null
  /** Latest rotation epoch when source recall runs on a chat with session rotations. */
  sessionRotationEpoch?: number
  trust: 'historical-data'
}

export type ChatSpineTurnEvidence = { itemId: string; text: string }

export type ChatSpineTurn = {
  userItemId: string
  user: string
  assistant?: { itemId: string; text: string }
  plan?: { itemId: string; text: string }
  evidence?: ChatSpineTurnEvidence[]
}

export type ChatSpineRequest = {
  scope: 'current' | 'history'
  chatId?: string
  limit?: number
  beforeUserItemId?: string
  includeEvidence?: boolean
  includeChangedFiles?: boolean
}

export type ChatSpineResult = {
  chatId?: string
  threadId: string | null
  evidenceAvailability?: ChatEvidenceAvailability
  title: string | null
  cwd: string
  lastActivityAt: number
  changedFiles?: string[]
  turns: ChatSpineTurn[]
  hasMore: boolean
  nextBeforeUserItemId: string | null
  provenance: 'index' | 'transcript'
  trust: 'historical-data'
}
