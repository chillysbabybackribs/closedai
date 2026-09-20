import { checkedJson, compactText, normalizedDomains, records, result, text, type ProviderDeps } from './provider-utils.js'
import type { SearchProviderClient, SearchResult } from './types.js'
import { DEFAULT_TEXT_CHARS } from './research/coverage.js'

const BASE = 'https://api.exa.ai/search'
/** `deep` variants synthesize answers over tens of seconds; discovery stays within the router deadline. */
const SEARCH_TYPE = { quick: 'fast', balanced: 'auto', deep: 'auto' } as const
/** Application default, adjustable per research run; not an Exa limit. */
export const EXA_TEXT_CHARS = DEFAULT_TEXT_CHARS
const HIGHLIGHT_CHARS = 1_500
const FRESHNESS_DAYS: Record<string, number> = { day: 1, week: 7, month: 31, year: 366 }

/**
 * Exa's own semantic index with page contents in the same call: query-guided highlights become the
 * snippet, and research runs (`sourceText`) also receive the page text so no fetch is needed.
 * https://docs.exa.ai/reference/search
 */
export function exaClient(deps: ProviderDeps, now: () => number = Date.now): SearchProviderClient {
  return {
    provider: 'exa',
    async search(request, signal) {
      const key = await deps.readKey('exa')
      const includeDomains = normalizedDomains(request.includeDomains).slice(0, 1200)
      const excludeDomains = normalizedDomains(request.excludeDomains).slice(0, 1200)
      const published = publishedRange(request.freshness, now())
      const response = await deps.fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({
          query: request.query,
          type: SEARCH_TYPE[request.depth],
          numResults: Math.min(request.count, 100),
          ...(request.intent === 'news' ? { category: 'news' } : {}),
          ...(request.country ? { userLocation: request.country.toUpperCase() } : {}),
          ...(published.start ? { startPublishedDate: published.start } : {}),
          ...(published.end ? { endPublishedDate: published.end } : {}),
          ...(includeDomains.length ? { includeDomains } : {}),
          ...(excludeDomains.length ? { excludeDomains } : {}),
          contents: {
            highlights: { query: request.query, maxCharacters: HIGHLIGHT_CHARS },
            ...(request.sourceText ? { text: extractionText(request.maxTextChars ?? EXA_TEXT_CHARS) } : {})
          }
        }),
        signal
      })
      const body = await checkedJson(response, 'exa') as Record<string, unknown>
      const results = records(body.results)
        .map((item) => exaResult(item, request.sourceText === true, request.maxTextChars ?? EXA_TEXT_CHARS))
        .filter((item): item is SearchResult => item !== null)
      return { provider: 'exa', results }
    }
  }
}

function exaResult(item: Record<string, unknown>, wantText: boolean, maxChars: number): SearchResult | null {
  const highlights = Array.isArray(item.highlights) ? item.highlights.filter((value): value is string => typeof value === 'string' && value.trim() !== '') : []
  const pageText = text(item.text)
  const snippet = compactText(highlights) || text(item.summary) || pageText.slice(0, 600)
  const base = result('exa', { ...item, snippet }, { url: ['url'], title: ['title'], snippet: ['snippet'], age: ['publishedDate'] })
  if (!base || !wantText || !pageText.trim()) return base
  const author = text(item.author).trim()
  return {
    ...base,
    content: { text: pageText, highlights, truncated: maxChars > 0 && pageText.length >= maxChars, ...(author ? { author: author.slice(0, 200) } : {}) }
  }
}

function extractionText(maxChars: number) {
  return { ...(maxChars > 0 ? { maxCharacters: maxChars } : {}), verbosity: 'compact' }
}

/** Selected-source expansion uses Contents directly; no repeat discovery or generated summary. */
export async function exaContents(deps: ProviderDeps, url: string, maxChars: number, signal: AbortSignal): Promise<SearchResult> {
  const key = await deps.readKey('exa')
  signal.throwIfAborted()
  const response = await deps.fetch('https://api.exa.ai/contents', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    // Coverage and freshness are distinct: retain Exa's normal cache/fetch policy so expansion
    // does not fail merely because an origin refuses or times out on a forced fresh crawl.
    body: JSON.stringify({ ids: [url], text: extractionText(maxChars), livecrawlTimeout: 15_000 }),
    signal
  })
  const body = await checkedJson(response, 'exa') as Record<string, unknown>
  const status = records(body.statuses)[0]
  if (status && status.status !== 'success') throw new Error(`Exa contents failed: ${text(status.status)} ${text((status.error as Record<string, unknown> | undefined)?.tag)}`)
  const item = records(body.results)[0]
  const page = item && exaResult(item, true, maxChars)
  if (!page?.content) throw new Error('Exa returned no page text for this URL')
  return page
}

/** Relative windows and validated `YYYY-MM-DDtoYYYY-MM-DD` ranges become inclusive published-date bounds. */
function publishedRange(freshness: string | undefined, now: number): { start?: string; end?: string } {
  if (!freshness) return {}
  const days = FRESHNESS_DAYS[freshness]
  if (days) return { start: new Date(now - days * 86_400_000).toISOString() }
  const [start, end] = freshness.split('to')
  if (!start || !end) return {}
  return { start: `${start}T00:00:00.000Z`, end: `${end}T23:59:59.999Z` }
}
