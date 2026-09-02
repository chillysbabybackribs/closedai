// Bounding tool results without corrupting them. Code-mode models routinely JSON.parse a
// tool result inside `exec`, and slicing a JSON document at N characters leaves a string
// that throws. When the text is JSON, shrink it structurally (shorter strings, fewer array
// items, then shallower nesting) so it stays parseable and carries its own truncation note;
// otherwise fall back to a plain cut with a footer.

export const TRUNCATION_NOTE_KEY = '_closedai_truncated'

const STRING_STEPS = [4_000, 1_000, 300, 100, 40] as const
const ARRAY_STEPS = [200, 60, 20, 8, 3] as const
const DEPTH_STEPS = [64, 8, 4, 2, 1] as const

export type TruncatedText = { text: string; truncated: boolean }

/** Bound `text` to `maxChars`, keeping JSON parseable when it is JSON. */
export function truncateText(text: string, maxChars: number, advice: string): TruncatedText {
  if (text.length <= maxChars) return { text, truncated: false }
  const structural = truncateJsonText(text, maxChars, advice)
  if (structural) return { text: structural, truncated: true }
  const dropped = text.length - maxChars
  return {
    text: `${text.slice(0, maxChars)}\n\n[ClosedAI truncated ${dropped} characters. ${advice}]`,
    truncated: true
  }
}

/** Structural truncation for JSON text; null when the text is not a JSON object or array. */
export function truncateJsonText(text: string, maxChars: number, advice: string): string | null {
  const trimmed = text.trimStart()
  if (text.length <= maxChars || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const original = text.length
  const indent = /^\s*[[{]\s*\n/.test(text) ? 2 : undefined
  for (let step = 0; step < STRING_STEPS.length; step += 1) {
    const shrunk = shrink(value, STRING_STEPS[step]!, ARRAY_STEPS[step]!, DEPTH_STEPS[step]!)
    const noted = withNote(shrunk, `Structurally truncated from ${original} characters (strings cut to ${STRING_STEPS[step]}, arrays to ${ARRAY_STEPS[step]} items, depth ${DEPTH_STEPS[step]}). ${advice}`)
    const out = JSON.stringify(noted, null, indent)
    if (out.length <= maxChars) return out
  }
  return JSON.stringify(withNote({}, `Result of ${original} characters was too large to return. ${advice}`))
}

function shrink(value: unknown, maxString: number, maxItems: number, depth: number): unknown {
  if (typeof value === 'string') {
    return value.length > maxString ? `${value.slice(0, maxString)}…[+${value.length - maxString} chars]` : value
  }
  if (value === null || typeof value !== 'object') return value
  if (depth <= 0) return Array.isArray(value) ? `[array of ${value.length}]` : `{object with ${Object.keys(value).length} keys}`
  if (Array.isArray(value)) {
    const kept = value.slice(0, maxItems).map((item) => shrink(item, maxString, maxItems, depth - 1))
    if (value.length > maxItems) kept.push(`…[+${value.length - maxItems} more items]`)
    return kept
  }
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) out[key] = shrink(entry, maxString, maxItems, depth - 1)
  return out
}

function withNote(value: unknown, note: string): unknown {
  if (Array.isArray(value)) return [...value, `[${TRUNCATION_NOTE_KEY}] ${note}`]
  if (value && typeof value === 'object') return { [TRUNCATION_NOTE_KEY]: note, ...(value as Record<string, unknown>) }
  return { [TRUNCATION_NOTE_KEY]: note, value }
}
