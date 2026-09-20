import { asRecord, checkedJson, queryWithDomains, records, result, text, type ProviderDeps } from './provider-utils.js'
import type { SearchProviderClient, SearchRequest } from './types.js'

const BASE = 'https://api.search.brave.com/res/v1/llm/context'
const FRESHNESS: Record<string, string> = { day: 'pd', week: 'pw', month: 'pm', year: 'py' }
const TUNING = {
  quick: { candidates: 10, tokens: 2_048, tokensPerUrl: 1_024, threshold: 'strict' },
  balanced: { candidates: 20, tokens: 8_192, tokensPerUrl: 2_048, threshold: 'balanced' },
  deep: { candidates: 50, tokens: 16_384, tokensPerUrl: 4_096, threshold: 'balanced' }
} as const

export function braveClient(deps: ProviderDeps): SearchProviderClient {
  return {
    provider: 'brave',
    async search(request, signal) {
      const key = await deps.readKey('brave')
      const tuning = TUNING[request.depth]
      const params = new URLSearchParams({
        q: braveQuery(request),
        count: String(Math.max(request.count, tuning.candidates)),
        maximum_number_of_urls: String(Math.min(request.count, 50)),
        maximum_number_of_tokens: String(request.contextTokens ?? tuning.tokens),
        maximum_number_of_tokens_per_url: String(tuning.tokensPerUrl),
        context_threshold_mode: request.relevance ?? tuning.threshold,
        enable_source_metadata: 'true',
        safesearch: 'moderate'
      })
      if (request.country) params.set('country', request.country.toUpperCase())
      if (request.language) params.set('search_lang', request.language.toLowerCase().split('-')[0]!)
      if (request.freshness) params.set('freshness', FRESHNESS[request.freshness] ?? request.freshness)
      const goggles = request.goggles ?? request.preferredDomains?.map((domain) => `$boost=3,site=${domain}`).join('\n')
      if (goggles) params.set('goggles', goggles)
      const response = await deps.fetch(`${BASE}?${params}`, {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': key,
          ...(request.live ? { 'Cache-Control': 'no-cache' } : {})
        },
        signal
      })
      const body = await checkedJson(response, 'brave') as Record<string, unknown>
      const grounding = asRecord(body.grounding)
      const sources = asRecord(body.sources)
      const results = records(grounding?.generic).map((item) => {
        const source = asRecord(sources?.[text(item.url)])
        const ages = Array.isArray(source?.age) ? source.age : []
        const normalized = {
          ...item,
          title: text(item.title) || text(source?.title),
          age: ages.find((age, index) => index >= 2 && typeof age === 'string') ?? ages.find((age) => typeof age === 'string')
        }
        return result('brave', normalized, {
          url: ['url'], title: ['title'], snippet: ['snippets'], age: ['age']
        })
      }).filter((item) => item !== null)
      return { provider: 'brave', results }
    }
  }
}

function braveQuery(request: SearchRequest): string {
  const scoped = queryWithDomains(request.query, request.includeDomains, request.excludeDomains)
  if (scoped.length <= 600 && scoped.trim().split(/\s+/).length <= 75) return scoped
  const filters = queryWithDomains('', request.includeDomains, request.excludeDomains).trim()
  throw new Error('Brave query including domain filters exceeds 600 characters or 75 words; narrow the query or filters')
}
