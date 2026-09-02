import { textResult, type JsonObject, type ToolResult } from './tool.js'

// Every result is replayed to the model on later turns. Keep structured inspection
// output useful without letting a large DOM or protocol response dominate the thread.
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
      'Narrow the request with a smaller limit or a more specific query.]'
  }
  return textResult(text)
}
