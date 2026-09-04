import type {
  ProviderSearchResult,
  SearchDepth,
  SearchIntent,
  SearchProvider,
  SearchProviderClient,
  SearchRequest,
  SearchResponse,
  SearchResult
} from './types.js'
import { abortable, RequestBudget } from './request-budget.js'

export type SearchUpdate = { output: ProviderSearchResult } | { error: { provider: SearchProvider; message: string } }
export type SearchObserver = (update: SearchUpdate) => void

const ROUTES: Record<SearchIntent, Record<SearchDepth, SearchProvider[]>> = {
  general: {
    quick: ['brave'], balanced: ['brave', 'serper'], deep: ['brave', 'serper', 'tavily']
  },
  news: {
    quick: ['serper'], balanced: ['serper', 'you'], deep: ['serper', 'you', 'brave']
  },
  research: {
    quick: ['tavily'], balanced: ['tavily', 'you'], deep: ['tavily', 'you', 'brave']
  },
  answer: {
    quick: ['you'], balanced: ['you', 'tavily'], deep: ['you', 'tavily', 'brave']
  },
  finance: {
    quick: ['you'], balanced: ['you', 'serper'], deep: ['you', 'serper', 'tavily']
  },
  technical: {
    quick: ['brave'], balanced: ['brave', 'serper'], deep: ['brave', 'serper', 'tavily']
  }
}

const CACHE_TTL_MS = 10 * 60 * 1_000
const MAX_CACHE_ENTRIES = 100

export function selectProviders(request: SearchRequest): SearchProvider[] {
  return request.providers?.length ? [...new Set(request.providers)] : ROUTES[request.intent][request.depth]
}

export class SearchRouter {
  private readonly clients: Map<SearchProvider, SearchProviderClient>
  private readonly cache = new Map<string, { at: number; response: SearchResponse }>()
  private readonly budget = new RequestBudget(4, 2)

  constructor(clients: SearchProviderClient[], private readonly now: () => number = Date.now) {
    this.clients = new Map(clients.map((client) => [client.provider, client]))
  }

  async search(request: SearchRequest, signal: AbortSignal, observe?: SearchObserver, owner = 'query'): Promise<SearchResponse> {
    signal.throwIfAborted()
    const providers = selectProviders(request)
    const { live: _live, ...cacheableRequest } = request
    const cacheKey = JSON.stringify({ ...cacheableRequest, providers })
    if (!request.live) {
      const cached = this.cache.get(cacheKey)
      if (cached && this.now() - cached.at < CACHE_TTL_MS) {
        for (const provider of providers) observe?.({ output: {
          provider,
          results: cached.response.results.filter((item) => item.provider === provider || item.corroboratedBy?.includes(provider))
            .map((item) => ({ ...item, provider })),
          answer: cached.response.answers.find((item) => item.provider === provider)?.text
        } })
        return { ...cached.response, cached: true }
      }
    }

    const settled = await Promise.allSettled(providers.map(async (provider) => {
      try {
        const output = await this.budget.run(provider, owner, signal, async () => {
          const client = this.clients.get(provider)
          if (!client) throw new Error(`${provider} client is not configured`)
          const deadline = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
          return abortable(client.search(request, deadline), deadline)
        })
        signal.throwIfAborted()
        observe?.({ output })
        return output
      } catch (error) {
        if (!signal.aborted) observe?.({ error: { provider, message: messageOf(error) } })
        throw error
      }
    }))
    const outputs: ProviderSearchResult[] = []
    const errors: SearchResponse['errors'] = []
    settled.forEach((outcome, index) => {
      const provider = providers[index]!
      if (outcome.status === 'fulfilled') outputs.push(outcome.value)
      else errors.push({ provider, message: messageOf(outcome.reason) })
    })
    if (outputs.length === 0) {
      throw new Error(`every selected search provider failed: ${errors.map((error) => `${error.provider}: ${error.message}`).join('; ')}`)
    }

    const response: SearchResponse = {
      query: request.query,
      intent: request.intent,
      depth: request.depth,
      providers,
      answers: outputs.flatMap((output) => output.answer ? [{ provider: output.provider, text: output.answer }] : []),
      results: mergeResults(outputs, request.count),
      errors
    }
    this.pruneCache()
    if (!signal.aborted && errors.length === 0) this.cache.set(cacheKey, { at: this.now(), response })
    return response
  }

  private pruneCache(): void {
    const now = this.now()
    for (const [key, entry] of this.cache) {
      if (now - entry.at >= CACHE_TTL_MS) this.cache.delete(key)
    }
    while (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value
      if (!oldestKey) break
      this.cache.delete(oldestKey)
    }
  }
}

function mergeResults(outputs: ProviderSearchResult[], perProviderCount: number): SearchResult[] {
  const merged: SearchResult[] = []
  const byUrl = new Map<string, SearchResult>()
  const longest = Math.max(0, ...outputs.map((output) => output.results.length))
  for (let index = 0; index < longest; index += 1) {
    for (const output of outputs) {
      const candidate = output.results[index]
      if (!candidate || index >= perProviderCount) continue
      const key = canonicalUrl(candidate.url)
      const existing = byUrl.get(key)
      if (existing) {
        existing.corroboratedBy = [...new Set([...(existing.corroboratedBy ?? []), candidate.provider])]
        continue
      }
      const copy = { ...candidate }
      byUrl.set(key, copy)
      merged.push(copy)
    }
  }
  return merged
}

export function canonicalUrl(value: string): string {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_') || ['gclid', 'fbclid', 'ref'].includes(key)) url.searchParams.delete(key)
    }
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return value
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
