import { jsonResult, MAX_OUTPUT_CHARS } from '../json-result.js'
import type { ToolResult } from '../tool.js'

// Listing where every match sits lets a caller jump straight to the second occurrence (a pricing
// table row after the plan card) instead of guessing offsets across refetches.
const MAX_LISTED_MATCHES = 12

/** Fit the serialized envelope, including escaped prose, before the generic truncator runs. */
export function textWindow(
  text: string,
  metadata: Record<string, unknown>,
  options: { maxChars: number; offset?: number; contains?: string; sourceTruncated?: boolean; canContinue?: boolean }
): ToolResult {
  const requestedOffset = options.offset ?? 0
  const search = options.contains === undefined ? undefined : findMatches(text, options.contains, requestedOffset)
  const match = search?.match
  const contextChars = Math.min(400, Math.floor(options.maxChars / 4))
  // A match window may start before `offset`, so passing a listed match offset keeps its lead-in.
  const offset = match === undefined ? requestedOffset : match < 0 ? requestedOffset : Math.max(0, match - contextChars)
  const remaining = match !== undefined && match < 0 ? '' : text.slice(offset)
  const make = (length: number) => ({
    ...metadata,
    text: remaining.slice(0, length),
    totalChars: text.length,
    offset,
    returnedChars: length,
    nextOffset: options.canContinue !== false && length > 0 && offset + length < text.length ? offset + length : null,
    ...(search === undefined ? {} : matchFacts(search, options, requestedOffset, text.length)),
    bodyTruncated: Boolean(options.sourceTruncated || offset > 0 || length < text.length),
    ...(options.sourceTruncated ? { sourceTruncated: true } : {})
  })
  let low = 0
  let high = Math.min(remaining.length, options.maxChars)
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (JSON.stringify(make(mid), null, 2).length <= MAX_OUTPUT_CHARS) low = mid
    else high = mid - 1
  }
  return jsonResult(make(low))
}

type MatchSearch = { match: number; count: number; offsets: number[] }

function findMatches(text: string, needle: string, from: number): MatchSearch {
  const haystack = text.toLowerCase()
  const lowered = needle.toLowerCase()
  const offsets: number[] = []
  let count = 0
  let match = -1
  for (let at = haystack.indexOf(lowered); at >= 0; at = haystack.indexOf(lowered, at + lowered.length)) {
    count += 1
    if (offsets.length < MAX_LISTED_MATCHES) offsets.push(at)
    if (match < 0 && at >= from) match = at
  }
  return { match, count, offsets }
}

function matchFacts(search: MatchSearch, options: { contains?: string; sourceTruncated?: boolean }, from: number, totalChars: number) {
  const facts = { matchOffset: search.match < 0 ? null : search.match, matchCount: search.count, matchOffsets: search.offsets }
  if (search.match >= 0) return facts
  const needle = JSON.stringify(options.contains)
  const cutoff = options.sourceTruncated ? ' The response body hit the fetch ceiling, so later text was not searched.' : ''
  const hint = search.count > 0
    ? `No match for ${needle} at or after offset ${from}; all ${search.count} match(es) are earlier, at matchOffsets. Pass one of those as offset.${cutoff}`
    : `${needle} does not occur in the ${totalChars} characters of extracted text. Try a shorter or different phrase, or format: raw for markup.${cutoff}`
  return { ...facts, hint }
}
