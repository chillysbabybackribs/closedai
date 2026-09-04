import { defineTool } from '../tool.js'
import { numberArg, stringArg, textResult } from '../tool.js'
import type { JsonObject, ToolNamespace } from '../tool.js'
import { braveClient } from './brave.js'
import { readSearchKey, type SearchKeyReader } from './keyring.js'
import { SearchRouter } from './router.js'
import { serperClient } from './serper.js'
import { tavilyClient } from './tavily.js'
import { SEARCH_DEPTHS, SEARCH_INTENTS, SEARCH_PROVIDERS, type SearchDepth, type SearchIntent, type SearchProvider } from './types.js'
import { youClient } from './you.js'
import { ResearchService, type ResearchDependencies } from './research/service.js'
import { researchTools } from './research/tools.js'

export type SearchToolDeps = {
  fetch?: typeof fetch; readKey?: SearchKeyReader; now?: () => number
  research?: ResearchDependencies
  onResearchCreated?: (service: ResearchService) => void
}

export function searchTools(deps: SearchToolDeps = {}): ToolNamespace {
  const providerDeps = { fetch: deps.fetch ?? fetch, readKey: deps.readKey ?? readSearchKey }
  const router = new SearchRouter([
    braveClient(providerDeps), serperClient(providerDeps), tavilyClient(providerDeps), youClient(providerDeps)
  ], deps.now)
  const query = defineTool({
      name: 'query',
      description:
        'One normalized search surface backed by Brave, Serper, Tavily, and You.com. ' +
        'Choose intent by the evidence needed: general for broad discovery; news for current reporting; ' +
        'research for content-rich investigation; answer for a cited synthesis; finance for market/business research; ' +
        'technical for documentation and implementation details. depth=quick uses one optimal provider, balanced uses two ' +
        'complementary indexes, and deep uses three. Omit providers to use this routing; set providers only to override it. ' +
        'Set live=true when current results matter; it bypasses the ten-minute cache and refreshes it. ' +
        'Results are normalized, interleaved, deduplicated, and marked when multiple indexes list the same URL (not factual corroboration). ' +
        'The result is JSON text; JSON.parse the returned string in exec scripts.',
      timeoutMs: 45_000,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 1_000, description: 'Search query or question.' },
          intent: { type: 'string', enum: [...SEARCH_INTENTS], description: 'Evidence shape used to select providers.' },
          depth: { type: 'string', enum: [...SEARCH_DEPTHS], description: 'quick=1 provider, balanced=2, deep=3. Default balanced.' },
          live: { type: 'boolean', description: 'Bypass the ten-minute cache and refresh it with current provider results.' },
          providers: { type: 'array', items: { type: 'string', enum: [...SEARCH_PROVIDERS] }, description: 'Optional explicit provider override.' },
          count: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum results per provider; default 5.' },
          freshness: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Optional recency filter.' },
          country: { type: 'string', minLength: 2, maxLength: 2, description: 'Optional two-letter country code.' },
          language: { type: 'string', minLength: 2, maxLength: 2, description: 'Optional two-letter language code.' },
          include_domains: { type: 'array', items: { type: 'string' }, description: 'Restrict supported providers to these domains.' },
          exclude_domains: { type: 'array', items: { type: 'string' }, description: 'Exclude these domains on supported providers.' }
        },
        required: ['query', 'intent'],
        additionalProperties: false
      },
      async run(input, context) {
        const request = {
          query: stringArg(input, 'query')!,
          intent: stringArg(input, 'intent') as SearchIntent,
          depth: stringArg(input, 'depth', 'balanced') as SearchDepth,
          count: numberArg(input, 'count', 5),
          ...(input.live === true ? { live: true } : {}),
          ...optionalString(input, 'freshness'),
          ...optionalString(input, 'country'),
          ...optionalString(input, 'language'),
          ...(stringArray(input, 'providers') ? { providers: stringArray(input, 'providers') as SearchProvider[] } : {}),
          ...(stringArray(input, 'include_domains') ? { includeDomains: stringArray(input, 'include_domains') } : {}),
          ...(stringArray(input, 'exclude_domains') ? { excludeDomains: stringArray(input, 'exclude_domains') } : {})
        }
        return textResult(JSON.stringify(await router.search(request, context.signal), null, 2))
      }
    })
  const research = deps.research ? new ResearchService(router, deps.research) : null
  if (research) deps.onResearchCreated?.(research)
  return {
    name: 'search',
    description: 'Public web lookup and incremental parallel research with retained source evidence.',
    tools: [query, ...(research ? researchTools(research, query) : [])]
  }
}

function stringArray(input: JsonObject, key: string): string[] | undefined {
  const value = input[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

function optionalString(input: JsonObject, key: string): Record<string, string> {
  const value = stringArg(input, key)
  return value ? { [key]: value } : {}
}

export { SearchRouter, selectProviders } from './router.js'
export type { SearchRequest, SearchResponse, SearchProviderClient } from './types.js'
