import { textResult, type JsonObject, type ToolResult } from '../tool.js'

// Every result is replayed to the model on every later turn, so a CDP dump must stay a
// working-set expense, not a permanent one. 20k chars is ~5k tokens — half the registry-wide
// ceiling — and big responses (DOM trees, AX trees, inspections) truncate with advice instead.
const MAX_OUTPUT_CHARS = 20_000

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
  if (text.length > MAX_OUTPUT_CHARS) {
    text = `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [ClosedAI truncated ${text.length - MAX_OUTPUT_CHARS} characters. ` +
      'Narrow the request — fewer max_elements, a tighter params object (depth, filters), or a more specific query.]'
  }
  return textResult(text)
}
