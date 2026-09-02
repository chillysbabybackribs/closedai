import { textResult, type JsonObject, type ToolResult } from '../tool.js'

const MAX_OUTPUT_CHARS = 200_000

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
    text = `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [ClosedAI truncated ${text.length - MAX_OUTPUT_CHARS} characters]`
  }
  return textResult(text)
}
