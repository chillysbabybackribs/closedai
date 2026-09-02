import { textResult, type JsonObject, type ToolResult } from './tool.js'
import { truncateText } from './truncate-json.js'

// Every result is replayed to the model on later turns, so a DOM, protocol, or app inspection
// dump must stay a working-set expense, not a permanent one. 16k chars is ~4k tokens; larger
// results shrink structurally (`truncate-json.ts`) so they stay valid JSON for a code-mode
// script's JSON.parse and carry a `_closedai_truncated` note with advice instead of a cut.
const MAX_OUTPUT_CHARS = 16_000
const ADVICE = 'Narrow the request — a smaller limit, fewer max_elements, a tighter params object (depth, filters), or a more specific query.'

export function objectSchema(properties: Record<string, JsonObject>, required: string[] = []): JsonObject {
  return { type: 'object', properties, required, additionalProperties: false }
}

export function jsonResult(value: unknown): ToolResult {
  let text: string
  try {
    text = JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  return textResult(truncateText(text, MAX_OUTPUT_CHARS, ADVICE).text)
}
