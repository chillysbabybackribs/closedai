import { checkedJson, freshnessCode, queryWithDomains, records, result, type ProviderDeps } from './provider-utils.js'
import type { SearchProviderClient } from './types.js'

const BASE = 'https://google.serper.dev'

export function serperClient(deps: ProviderDeps): SearchProviderClient {
  return {
    provider: 'serper',
    async search(request, signal) {
      const key = await deps.readKey('serper')
      const freshness = freshnessCode(request.freshness)
      const endpoint = request.intent === 'news' ? `${BASE}/news` : `${BASE}/search`
      const response = await deps.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
        body: JSON.stringify({
          q: queryWithDomains(request.query, request.includeDomains, request.excludeDomains),
          num: Math.min(request.count, 100),
          ...(request.country ? { gl: request.country.toLowerCase() } : {}),
          ...(request.language ? { hl: request.language.toLowerCase() } : {}),
          ...(freshness ? { tbs: freshness } : {})
        }),
        signal
      })
      const body = await checkedJson(response, 'serper') as Record<string, unknown>
      const organic = records(body.organic).map((item) => result('serper', item, {
        url: ['link', 'url'], title: ['title'], snippet: ['snippet', 'description'], age: ['date'], score: ['position']
      }))
      const news = records(body.news).map((item) => result('serper', item, {
        url: ['link', 'url'], title: ['title'], snippet: ['snippet', 'description'], age: ['date']
      }))
      return { provider: 'serper', results: [...organic, ...news].filter((item) => item !== null).slice(0, request.count) }
    }
  }
}
