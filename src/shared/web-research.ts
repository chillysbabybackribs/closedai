/** Public research facts; source text and provider output are untrusted evidence. */
export type ResearchState = 'running' | 'completed' | 'cancelled' | 'timed_out'
/** static_text: inert parse of the fetched body. rendered_text: innerText of a hidden Chromium page. */
export type SourceRepresentation = 'static_text' | 'rendered_text'
export type ResearchSource = {
  id: string
  url: string
  title: string
  discoveredBy: string[]
  snippet: string
  /** rendering: the static read found a JavaScript shell and a hidden worker is loading the page. */
  state: 'queued' | 'reading' | 'rendering' | 'ready' | 'failed'
  revision: number
  representation?: SourceRepresentation
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
