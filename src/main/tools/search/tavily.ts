import { checkedJson, records, result, text, type ProviderDeps } from './provider-utils.js'
import type { SearchProviderClient } from './types.js'

const BASE = 'https://api.tavily.com/search'
const SEARCH_DEPTH = { quick: 'fast', balanced: 'basic', deep: 'advanced' } as const

export function tavilyClient(deps: ProviderDeps): SearchProviderClient {
  return {
    provider: 'tavily',
    async search(request, signal) {
      const key = await deps.readKey('tavily')
      const includeAnswer = ['answer', 'research', 'finance'].includes(request.intent) || request.depth === 'deep'
      const topic = request.intent === 'news' ? 'news' : request.intent === 'finance' ? 'finance' : 'general'
      const country = topic === 'general' && request.country ? countryName(request.country) : undefined
      const response = await deps.fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query: request.query,
          search_depth: SEARCH_DEPTH[request.depth],
          topic,
          max_results: Math.min(request.count, 20),
          include_answer: includeAnswer ? (request.depth === 'deep' ? 'advanced' : 'basic') : false,
          chunks_per_source: request.depth === 'quick' ? 1 : 3,
          ...(request.freshness ? { time_range: request.freshness } : {}),
          ...(request.includeDomains?.length ? { include_domains: request.includeDomains.slice(0, 300) } : {}),
          ...(request.excludeDomains?.length ? { exclude_domains: request.excludeDomains.slice(0, 150) } : {}),
          ...(country ? { country } : {}),
          ...(request.language ? { language: request.language.toLowerCase(), filter_by_language: true } : {})
        }),
        signal
      })
      const body = await checkedJson(response, 'tavily') as Record<string, unknown>
      const results = records(body.results).map((item) => result('tavily', item, {
        url: ['url'], title: ['title'], snippet: ['content'], age: ['published_date'], score: ['score']
      })).filter((item) => item !== null)
      return { provider: 'tavily', results, ...(text(body.answer) ? { answer: text(body.answer) } : {}) }
    }
  }
}

function countryName(code: string): string | undefined {
  const normalized = code.toUpperCase()
  const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(normalized)
  return name && name !== normalized ? name.toLowerCase() : undefined
}
