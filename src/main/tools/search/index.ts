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
import { SourcePresentation, SEARCH_PRESENTATION_FIELD } from './presentation.js'

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
        'Search via Brave, Serper, Tavily, and You.com. Pick intent by evidence: general, news, research, answer, finance, technical. ' +
        'Default depth=quick (one provider); balanced/deep when corroboration matters and may return complete=false once enough providers answer. live=true bypasses the ten-minute cache. ' +
        'Live opens source URLs, never search-engine pages; presentation=background opts out. Prefer search.run for parallel research. ' +
        'Results are normalized JSON; JSON.parse the returned string in exec scripts.',
      timeoutMs: 45_000,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 1_000, description: 'Search query or question.' },
          intent: { type: 'string', enum: [...SEARCH_INTENTS], description: 'Evidence shape used to select providers.' },
          depth: { type: 'string', enum: [...SEARCH_DEPTHS], description: 'quick=1 provider (default), balanced=2, deep=3.' },
          live: { type: 'boolean', description: 'Bypass the ten-minute cache and refresh it with current provider results.' },
          presentation: SEARCH_PRESENTATION_FIELD,
          providers: { type: 'array', items: { type: 'string', enum: [...SEARCH_PROVIDERS] }, description: 'Optional explicit provider override.' },
          count: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum results per provider; default 5.' },
          freshness: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Optional recency filter.' },
          country: { type: 'string', minLength: 2, maxLength: 2, description: 'Optional two-letter country code.' },
          language: { type: 'string', minLength: 2, maxLength: 12, description: 'Optional BCP 47 language code.' },
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
          depth: stringArg(input, 'depth', 'quick') as SearchDepth,
          count: numberArg(input, 'count', 5),
          ...(input.live === true ? { live: true } : {}),
          ...optionalString(input, 'freshness'),
          ...optionalString(input, 'country'),
          ...optionalString(input, 'language'),
          ...(stringArray(input, 'providers') ? { providers: stringArray(input, 'providers') as SearchProvider[] } : {}),
          ...(stringArray(input, 'include_domains') ? { includeDomains: stringArray(input, 'include_domains') } : {}),
          ...(stringArray(input, 'exclude_domains') ? { excludeDomains: stringArray(input, 'exclude_domains') } : {})
        }
        const presentation = new SourcePresentation(deps.research?.openLive, context, input.presentation)
        const response = await router.search(request, context.signal, (update) => {
          if ('output' in update) for (const source of update.output.results) presentation.consider(source.url)
        })
        presentation.finish()
        return textResult(JSON.stringify({ ...response, presentation: presentation.snapshot() }, null, 2))
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
