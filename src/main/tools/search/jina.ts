import { checkedJson, records, result, type ProviderDeps } from './provider-utils.js'
import type { SearchProviderClient } from './types.js'

const BASE = 'https://s.jina.ai'

export function jinaClient(deps: ProviderDeps): SearchProviderClient {
  return {
    provider: 'jina',
    async search(request, signal) {
      const key = await deps.readKey('jina')
      const response = await deps.fetch(`${BASE}/${encodeURIComponent(request.query)}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${key}`, 'X-Return-Format': 'markdown' },
        signal
      })
      const body = await checkedJson(response, 'jina') as Record<string, unknown>
      const results = records(body.data).map((item) => result('jina', item, {
        url: ['url'], title: ['title'], snippet: ['description', 'content']
      })).filter((item) => item !== null).slice(0, request.count)
      return { provider: 'jina', results }
    }
  }
}
