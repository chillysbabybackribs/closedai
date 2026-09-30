import type { ResearchSnapshot } from '../../../shared/web-research.js'
import type { SearchResponse } from './types.js'

/** Appended to search.query JSON and search.read snapshots when hits are not full-page ground truth. */
export const SEARCH_GROUNDING_HINT =
  'Snippets and provider answers are discovery only. For vendor limits, pricing, or multi-site comparisons, ground claims with embedded_browser.session fetch on each cited https origin; use site.discover bootstrap when you need robots, sitemap, or nav on an unfamiliar origin.'

export function searchResponseNeedsGroundingHint(response: Pick<SearchResponse, 'results' | 'answers'>): boolean {
  if (response.answers.length > 0) return true
  if (response.results.length === 0) return false
  return response.results.some((result) => !result.content?.text || result.content.truncated)
}

export function attachSearchGroundingHint<T extends object>(
  payload: T,
  response: Pick<SearchResponse, 'results' | 'answers'>
): T & { groundingHint?: string } {
  if (!searchResponseNeedsGroundingHint(response)) return payload
  return { ...payload, groundingHint: SEARCH_GROUNDING_HINT }
}

export function researchSnapshotNeedsGroundingHint(snapshot: ResearchSnapshot): boolean {
  if (snapshot.completedQueries > 0 && snapshot.sources.length === 0) return true
  if (snapshot.sources.length === 0) return false
  const hasRetainedPage = snapshot.sources.some(
    (source) =>
      source.state === 'ready' &&
      source.representation !== undefined &&
      source.representation !== 'provider_text' &&
      (source.chars ?? 0) >= 400 &&
      source.incomplete !== true
  )
  if (hasRetainedPage) return false
  return snapshot.sources.some(
    (source) => source.state !== 'ready' || source.incomplete === true || (source.chars ?? 0) < 400
  )
}

export function attachResearchGroundingHint(snapshot: ResearchSnapshot): ResearchSnapshot & { groundingHint?: string } {
  if (!researchSnapshotNeedsGroundingHint(snapshot)) return snapshot
  return { ...snapshot, groundingHint: SEARCH_GROUNDING_HINT }
}
