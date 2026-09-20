/** Public research facts; source text and provider output are untrusted evidence. */
export type ResearchState = 'running' | 'completed' | 'cancelled' | 'timed_out'
export type ResearchSource = {
  id: string
  url: string
  title: string
  discoveredBy: string[]
  snippet: string
  state: 'queued' | 'reading' | 'ready' | 'failed'
  revision: number
  retrievedAt?: string
  contentType?: string
  sha256?: string
  chars?: number
  incomplete?: boolean
  error?: string
}

export type ResearchSnapshot = {
  runId: string
  state: ResearchState
  cursor: number
  pending: number
  completedQueries: number
  totalQueries: number
  sourceCount: number
  omittedSources: number
  omittedErrors: number
  sources: ResearchSource[]
  errors: Array<{ query: string; provider?: string; message: string }>
  presentation: { state: 'none' | 'waiting_for_source' | 'no_source' | 'opened' | 'failed'; tabId?: string; error?: string }
}

/** Source facts the user-facing activity view needs; text is fetched on demand as an excerpt. */
export type ResearchActivitySource = Pick<
  ResearchSource, 'id' | 'url' | 'title' | 'state' | 'discoveredBy' | 'error' | 'chars' | 'incomplete' | 'retrievedAt'
>

/** One research run as the user sees it. Runs belong to a chat pane and the turn that started them. */
export type ResearchActivity = {
  runId: string
  paneId: string
  threadId: string
  turnId: string | null
  state: ResearchState
  startedAt: number
  finishedAt?: number
  /** Query texts in submission order, bounded like the model-facing error records. */
  queries: string[]
  completedQueries: number
  pending: number
  counts: { queued: number; reading: number; ready: number; failed: number }
  sources: ResearchActivitySource[]
  errors: ResearchSnapshot['errors']
  presentation: ResearchSnapshot['presentation']
}

export type ResearchActivityEvent =
  | { type: 'run'; run: ResearchActivity }
  | { type: 'evicted'; runId: string }

/** A page of retained source text for the user's own reading. Untrusted, statically parsed. */
export type ResearchExcerpt = {
  runId: string
  sourceId: string
  url: string
  title: string
  offset: number
  text: string
  nextOffset: number | null
  chars: number
  sha256?: string
  retrievedAt?: string
  incomplete?: boolean
}

export type ResearchApi = {
  /** Every retained run for a pane, oldest first. */
  activity: (paneId: string) => Promise<ResearchActivity[]>
  cancel: (runId: string) => Promise<void>
  excerpt: (runId: string, sourceId: string, offset?: number) => Promise<ResearchExcerpt>
  onEvent: (listener: (event: ResearchActivityEvent) => void) => () => void
}
