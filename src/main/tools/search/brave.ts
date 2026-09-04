import { checkedJson, queryWithDomains, records, result, type ProviderDeps } from './provider-utils.js'
import type { SearchProviderClient } from './types.js'

const BASE = 'https://api.search.brave.com/res/v1/web/search'
const FRESHNESS = { day: 'pd', week: 'pw', month: 'pm', year: 'py' } as const

export function braveClient(deps: ProviderDeps): SearchProviderClient {
  return {
    provider: 'brave',
    async search(request, signal) {
      const key = await deps.readKey('brave')
      const params = new URLSearchParams({
        q: queryWithDomains(request.query, request.includeDomains, request.excludeDomains),
        count: String(Math.min(request.count, 20)),
        extra_snippets: 'true'
      })
      if (request.country) params.set('country', request.country.toUpperCase())
      if (request.language) params.set('search_lang', request.language.toLowerCase())
      if (request.freshness) params.set('freshness', FRESHNESS[request.freshness])
      const response = await deps.fetch(`${BASE}?${params}`, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': key },
        signal
      })
      const body = await checkedJson(response, 'brave') as Record<string, unknown>
      const web = body.web && typeof body.web === 'object' ? body.web as Record<string, unknown> : {}
      const results = records(web.results).map((item) => result('brave', item, {
        url: ['url'], title: ['title'], snippet: ['description', 'extra_snippets'], age: ['age', 'page_age']
      })).filter((item) => item !== null)
      return { provider: 'brave', results }
    }
  }
}
