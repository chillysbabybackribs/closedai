const CONTEXT_BLOCK_RE = /<closedai_context\b[^>]*>[\s\S]*?<\/closedai_context>\s*/g

/** Remove ClosedAI instruction and attachment context blocks from a user message. */
export function stripContextBlocks(text: string): string {
  return text.replace(CONTEXT_BLOCK_RE, '').trim()
}

/** True when a title is really injected markup, not a human-readable name. */
export function isInjectedContextTitle(title: string): boolean {
  const trimmed = title.trim()
  return trimmed.includes('<closedai_context') || trimmed.includes('closedai.instructions')
}

/**
 * One-line label from the user's own words: strips app context blocks, takes the first
 * non-empty line, and clips to max. Returns empty when nothing remains.
 */
export function summarizeUserMessage(text: string, max = 60): string {
  const line = stripContextBlocks(text)
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean) ?? ''
  if (!line) return ''
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** Drop provider or persisted titles that are really injected context markup. */
export function sanitizeThreadTitle(title: string | null | undefined): string | null {
  const trimmed = title?.trim()
  if (!trimmed || isInjectedContextTitle(trimmed)) return null
  return trimmed
}

/** First line for thread previews (slightly longer than drawer titles). */
export function firstLineOfUserMessage(text: string, max = 80): string {
  return summarizeUserMessage(text, max)
}
