export const SEARCH_PROVIDERS = ['brave', 'exa', 'serper', 'tavily', 'you'] as const
export type SearchProvider = typeof SEARCH_PROVIDERS[number]

export const SEARCH_INTENTS = ['general', 'news', 'research', 'answer', 'finance', 'technical'] as const
export type SearchIntent = typeof SEARCH_INTENTS[number]

export const SEARCH_DEPTHS = ['quick', 'balanced', 'deep'] as const
export type SearchDepth = typeof SEARCH_DEPTHS[number]

export type SearchRequest = {
  query: string
  intent: SearchIntent
  depth: SearchDepth
  count: number
  live?: boolean
  providers?: SearchProvider[]
  freshness?: string
  country?: string
  language?: string
  includeDomains?: string[]
  excludeDomains?: string[]
  /** Research runs consume sources only; do not pay for discarded provider synthesis. */
  includeAnswer?: boolean
  /** Research runs ask providers that extract pages (Exa) for the text itself, not just snippets. */
  sourceText?: boolean
  /** Per-page extraction coverage; zero requests text without a character cap. */
  maxTextChars?: number
  preferredDomains?: string[]
  goggles?: string
  relevance?: 'strict' | 'balanced' | 'lenient' | 'disabled'
  contextTokens?: number
}

/** Page text a provider extracted alongside discovery: third-party extraction this app never fetched. */
export type ProvidedContent = {
  text: string
  highlights: string[]
  /** The requested character cap was reached; more text may exist. False is not a fidelity guarantee. */
  truncated: boolean
  author?: string
}

export type SearchResult = {
  title: string
  url: string
  snippet: string
  provider: SearchProvider
  discoveredBy?: SearchProvider[]
  content?: ProvidedContent
  age?: string
  score?: number
  /** Provider-reported age is not a verified publication date. */
  dates?: import('../../../shared/web-research.js').SourceDate[]
  discovery?: { provider: SearchProvider; observedAt: string; cached: boolean }
}

export type ProviderSearchResult = {
  provider: SearchProvider
  results: SearchResult[]
  answer?: string
}

export type SearchProviderClient = {
  provider: SearchProvider
  search(request: SearchRequest, signal: AbortSignal): Promise<ProviderSearchResult>
}

export type SearchResponse = {
  query: string
  intent: SearchIntent
  depth: SearchDepth
  providers: SearchProvider[]
  answers: Array<{ provider: SearchProvider; text: string }>
  results: SearchResult[]
  errors: Array<{ provider: SearchProvider; message: string }>
  /** False when the router returned before every selected provider finished. */
  complete?: boolean
  cached?: boolean
  observedAt?: string
  controls?: { appliedTo: SearchProvider[]; notAppliedTo: SearchProvider[] }
}
