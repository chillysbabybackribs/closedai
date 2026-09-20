/** Public research facts; source text and provider output are untrusted evidence. */
export type ResearchState = 'running' | 'completed' | 'cancelled' | 'timed_out'
/**
 * static_text: inert parse of the fetched body. rendered_text: innerText of a hidden Chromium page.
 * provider_text: page text a provider returned with discovery or selected-source extraction; this app never fetched the page.
 * pdf_text: local PDF.js extraction of downloaded bytes, with page markers; no OCR or visual verification.
 */
export type SourceRepresentation = 'static_text' | 'rendered_text' | 'provider_text' | 'pdf_text'
export type PdfCoverage = { totalPages: number; extractedPages: number; pagesWithoutText: number }
/** Reported date observations, never silently interpreted as verified event dates. */
export type SourceDate = {
  kind: 'published' | 'modified' | 'index_reported' | 'http_last_modified'
  value: string
  source: string
}
export type ResearchSource = {
  id: string
  url: string
  title: string
  discoveredBy: string[]
  snippet: string
  /** rendering: the static read found a JavaScript shell and a hidden worker is loading the page. */
  state: 'deferred' | 'queued' | 'reading' | 'rendering' | 'ready' | 'failed'
  /** Read priority, not a credibility or factual correctness score. */
  selection?: 'requested' | 'preferred_domain' | 'discovery'
  revision: number
  representation?: SourceRepresentation
  /** Search provider whose extraction supplied provider_text. */
  contentProvider?: string
  retrievedAt?: string
  contentType?: string
  sha256?: string
  chars?: number
  incomplete?: boolean
  pdf?: PdfCoverage
  /** Expansion preserves the previous readable document until a replacement succeeds. */
  expanding?: boolean
  expansionError?: string
  error?: string
  requestedUrl?: string
  dates?: SourceDate[]
  discovery?: Array<{ provider: string; observedAt: string; cached: boolean }>
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
  readCount?: number
  maxReads?: number
  reservedReads?: number
  omittedCandidates?: number
  sources: ResearchSource[]
  errors: Array<{ query: string; provider?: string; message: string }>
  presentation: { state: 'none' | 'waiting_for_source' | 'no_source' | 'opened' | 'failed'; tabId?: string; error?: string }
}
