import { asRecord, checkedJson, compactText, normalizedDomains, queryWithDomains, records, result, text, type ProviderDeps } from './provider-utils.js'
import type { SearchProviderClient, SearchResult } from './types.js'

const BASE = 'https://ydc-index.io/v1/search'

function responseResults(body: Record<string, unknown>): SearchResult[] {
  const nested = asRecord(body.results)
  const candidates = Array.isArray(body.results)
    ? records(body.results)
    : [...records(nested?.web), ...records(nested?.news), ...records(body.citations)]
  return candidates.map((item) => {
    const contents = asRecord(item.contents)
    const normalized = {
      ...item,
      description: compactText(item.description, item.snippets, contents?.highlights, item.highlights, item.excerpts)
    }
    return result('you', normalized, {
      url: ['url', 'source'], title: ['title'], snippet: ['description'], age: ['page_age']
    })
  }).filter((item) => item !== null)
}

export function youClient(deps: ProviderDeps): SearchProviderClient {
  return {
    provider: 'you',
    async search(request, signal) {
      const key = await deps.readKey('you')
      const includeDomains = normalizedDomains(request.includeDomains).slice(0, 500)
      const excludeDomains = normalizedDomains(request.excludeDomains).slice(0, 500)
      const hasInclude = includeDomains.length > 0
      const hasExclude = excludeDomains.length > 0
      const response = await deps.fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
        body: JSON.stringify({
          query: hasInclude && hasExclude
            ? queryWithDomains(request.query, includeDomains, excludeDomains)
            : request.query,
          count: Math.min(request.count, 100),
          ...(request.freshness ? { freshness: request.freshness } : {}),
          ...(request.country ? { country: request.country.toUpperCase() } : {}),
          ...(request.language ? { language: request.language.toUpperCase() } : {}),
          ...(hasInclude && !hasExclude ? { include_domains: includeDomains } : {}),
          ...(hasExclude && !hasInclude ? { exclude_domains: excludeDomains } : {}),
          ...(request.intent === 'answer' ? { knowledge: 'core' } : {})
        }),
        signal
      })
      const body = await checkedJson(response, 'you') as Record<string, unknown>
      const nested = asRecord(body.results)
      const knowledge = records(nested?.knowledge).find((item) => item.type === 'answer')
      const answer = text(knowledge?.description)
      return { provider: 'you', results: responseResults(body).slice(0, request.count), ...(answer ? { answer } : {}) }
    }
  }
}
