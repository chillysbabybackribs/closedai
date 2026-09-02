import { asRecord, checkedJson, compactText, records, result, text, type ProviderDeps } from './provider-utils.js'
import type { SearchProviderClient, SearchRequest, SearchResult } from './types.js'

const BASE = 'https://api.you.com/v1'

function endpoint(request: SearchRequest): { path: string; body: Record<string, unknown> } {
  if (request.intent === 'answer') return { path: 'answer', body: { query: request.query } }
  if (request.intent === 'research' || request.intent === 'finance') {
    return { path: request.intent === 'finance' ? 'finance-research' : 'research', body: { input: request.query } }
  }
  return {
    path: 'search',
    body: {
      query: request.query,
      count: request.count,
      ...(request.country ? { country: request.country } : {}),
      ...(request.includeDomains?.length ? { include_domains: request.includeDomains } : {}),
      ...(request.excludeDomains?.length ? { exclude_domains: request.excludeDomains } : {})
    }
  }
}

function responseResults(body: Record<string, unknown>): SearchResult[] {
  const nested = asRecord(body.results)
  const candidates = Array.isArray(body.results)
    ? records(body.results)
    : [...records(nested?.web), ...records(nested?.news), ...records(body.citations)]
  return candidates.map((item) => {
    const normalized = { ...item, description: compactText(item.description, item.snippets, item.highlights, item.excerpts) }
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
      const selected = endpoint(request)
      const response = await deps.fetch(`${BASE}/${selected.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
        body: JSON.stringify(selected.body),
        signal
      })
      const body = await checkedJson(response, 'you') as Record<string, unknown>
      const answer = text(body.output) || text(body.answer) || text(body.report)
      return { provider: 'you', results: responseResults(body).slice(0, request.count), ...(answer ? { answer } : {}) }
    }
  }
}
