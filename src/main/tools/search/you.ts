import { asRecord, checkedJson, compactText, queryWithDomains, records, result, text, type ProviderDeps } from './provider-utils.js'
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
      const hasInclude = Boolean(request.includeDomains?.length)
      const hasExclude = Boolean(request.excludeDomains?.length)
      const response = await deps.fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
        body: JSON.stringify({
          query: hasInclude && hasExclude
            ? queryWithDomains(request.query, request.includeDomains, request.excludeDomains)
            : request.query,
          count: Math.min(request.count, 100),
          ...(request.freshness ? { freshness: request.freshness } : {}),
          ...(request.country ? { country: request.country.toUpperCase() } : {}),
          ...(request.language ? { language: request.language.toUpperCase() } : {}),
          ...(hasInclude && !hasExclude ? { include_domains: request.includeDomains?.slice(0, 500) } : {}),
          ...(hasExclude && !hasInclude ? { exclude_domains: request.excludeDomains?.slice(0, 500) } : {}),
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
