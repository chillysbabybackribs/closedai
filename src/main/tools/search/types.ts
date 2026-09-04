export const SEARCH_PROVIDERS = ['brave', 'serper', 'tavily', 'you'] as const
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
  freshness?: 'day' | 'week' | 'month' | 'year'
  country?: string
  language?: string
  includeDomains?: string[]
  excludeDomains?: string[]
}

export type SearchResult = {
  title: string
  url: string
  snippet: string
  provider: SearchProvider
  corroboratedBy?: SearchProvider[]
  age?: string
  score?: number
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
  cached?: boolean
}
