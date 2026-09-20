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
