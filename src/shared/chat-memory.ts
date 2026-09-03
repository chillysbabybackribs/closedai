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
  scope: 'current' | 'source'
  query?: string
  itemId?: string
  offset?: number
  limit?: number
  beforeItemId?: string
}

export type ChatRecallResult = {
  threadId: string
  checkpoint: ChatMemoryCheckpoint | null
  matches: Array<{ itemId: string; turnId: string | null; role: string; text: string; offset: number; nextOffset: number | null }>
  hasMore: boolean
  nextBeforeItemId: string | null
  /** The explicit bound used when recalling a continuation's source. */
  throughItemId: string | null
  trust: 'historical-data'
}
