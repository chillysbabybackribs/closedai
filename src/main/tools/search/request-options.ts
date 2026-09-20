import type { JsonObject } from '../tool.js'
import { normalizedDomains } from './provider-utils.js'
import type { SearchRequest } from './types.js'

/** These controls have a documented implementation in Brave's LLM Context API. */
export const SOURCE_OPTION_FIELDS: JsonObject = {
  preferred_domains: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 253 }, description: 'Boost these domains without excluding others (Brave Goggles). Also prioritizes research reads. Requires Brave only; omit providers to select it.' },
  goggles: { type: 'string', minLength: 1, maxLength: 6000, description: 'Brave Goggle URL or inline ranking rules. Cannot combine with preferred_domains. Requires Brave only; omit providers to select it.' },
  relevance: { type: 'string', enum: ['strict', 'balanced', 'lenient', 'disabled'], description: 'Brave extraction relevance threshold, independent of depth. Defaults to strict for quick, balanced otherwise.' },
  context_tokens: { type: 'integer', minimum: 1024, maximum: 32768, description: 'Brave extracted-context budget, independent of discovery breadth. Requires Brave only; omit providers to select it.' }
}

export const FRESHNESS_FIELD = {
  type: 'string', pattern: '^(day|week|month|year|[0-9]{4}-[0-9]{2}-[0-9]{2}to[0-9]{4}-[0-9]{2}-[0-9]{2})$',
  description: 'Recency filter, or inclusive YYYY-MM-DDtoYYYY-MM-DD range (Brave only). Index dates may mean publication or modification, not verified evidence dates.'
}

export function sourceOptions(input: JsonObject): Partial<SearchRequest> {
  const preferred = input.preferred_domains as string[] | undefined
  const domains = normalizedDomains(preferred)
  if (preferred?.some((domain) => normalizedDomains([domain]).length !== 1)) throw new Error('preferred_domains contains an invalid domain')
  if (domains.length && input.goggles) throw new Error('Choose preferred_domains or goggles, not both')
  if (typeof input.freshness === 'string' && input.freshness.includes('to')) validateDateRange(input.freshness)
  return {
    ...(domains.length ? { preferredDomains: domains } : {}),
    ...(typeof input.goggles === 'string' ? { goggles: input.goggles } : {}),
    ...(typeof input.relevance === 'string' ? { relevance: input.relevance as SearchRequest['relevance'] } : {}),
    ...(typeof input.context_tokens === 'number' ? { contextTokens: input.context_tokens } : {})
  }
}

export function requiresBrave(request: SearchRequest): boolean {
  return !!(request.preferredDomains?.length || request.goggles || request.relevance || request.contextTokens || request.freshness?.includes('to'))
}

function validateDateRange(range: string): void {
  const parts = range.split('to')
  if (parts.length !== 2 || parts.some((part) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(part)) return true
    const date = new Date(`${part}T00:00:00Z`)
    return !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== part
  }) || parts[0] > parts[1]) throw new Error('freshness range requires valid ascending YYYY-MM-DD dates')
}
