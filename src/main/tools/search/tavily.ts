import { checkedJson, records, result, text, type ProviderDeps } from './provider-utils.js'
import type { SearchProviderClient } from './types.js'

const BASE = 'https://api.tavily.com/search'

export function tavilyClient(deps: ProviderDeps): SearchProviderClient {
  return {
    provider: 'tavily',
    async search(request, signal) {
      const key = await deps.readKey('tavily')
      const includeAnswer = ['answer', 'research', 'finance'].includes(request.intent) || request.depth === 'deep'
      const topic = request.intent === 'news' ? 'news' : request.intent === 'finance' ? 'finance' : 'general'
      const response = await deps.fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query: request.query,
          search_depth: request.depth === 'deep' ? 'advanced' : 'basic',
          topic,
          max_results: Math.min(request.count, 20),
          include_answer: includeAnswer,
          ...(request.freshness ? { time_range: request.freshness } : {}),
          ...(request.includeDomains?.length ? { include_domains: request.includeDomains } : {}),
          ...(request.excludeDomains?.length ? { exclude_domains: request.excludeDomains } : {})
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
