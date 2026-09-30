import { jsonResult, MAX_OUTPUT_CHARS } from '../json-result.js'
import type { ToolResult } from '../tool.js'

/** Fit the serialized envelope, including escaped prose, before the generic truncator runs. */
export function textWindow(
  text: string,
  metadata: Record<string, unknown>,
  options: { maxChars: number; offset?: number; contains?: string; sourceTruncated?: boolean; canContinue?: boolean }
): ToolResult {
  const requestedOffset = options.offset ?? 0
  const match = options.contains === undefined ? undefined : text.toLowerCase().indexOf(options.contains.toLowerCase(), requestedOffset)
  const contextChars = Math.min(400, Math.floor(options.maxChars / 4))
  const offset = match === undefined ? requestedOffset : match < 0 ? text.length : Math.max(requestedOffset, match - contextChars)
  const remaining = text.slice(offset)
  const make = (length: number) => ({
    ...metadata,
    text: remaining.slice(0, length),
    totalChars: text.length,
    offset,
    returnedChars: length,
    nextOffset: options.canContinue !== false && length > 0 && offset + length < text.length ? offset + length : null,
    ...(match === undefined ? {} : { matchOffset: match < 0 ? null : match }),
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
