import type { ChatTranscriptItem } from './chat.js'

const CONTEXT_BLOCK_RE = /<closedai_context\b[^>]*>[\s\S]*?<\/closedai_context>\s*/g

/** Remove ClosedAI instruction and attachment context blocks from a user message. */
export function stripContextBlocks(text: string): string {
  let out = text.replace(CONTEXT_BLOCK_RE, '')
  // Truncated tab titles and pasted fragments may leave a lone opening tag with no closer.
  out = out.replace(/<closedai_context\b[^>]*>[\s\S]*/gi, '')
  out = out.replace(/<closedai_context\b[^>]*/gi, '')
  out = out.replace(/<\/closedai_context>\s*/gi, '')
  return out.trim()
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

/** Continuation card digest preview: same cleanup as new handoffs, for records saved before title scrubbing. */
export function handoffDigestForDisplay(handoff: string): string {
  const out: string[] = []
  for (const line of handoff.split('\n')) {
    const header = line.match(/^Handoff from the previous chat "(.*)"\.$/)
    if (header) {
      out.push(`Handoff from the previous chat "${handoffSourceTitle(header[1])}".`)
      continue
    }
    if (line.includes('<closedai_context') || line.trim() === '</closedai_context>') continue
    if (line.startsWith('User: ')) {
      const cleaned = stripContextBlocks(line.slice(6).trim())
      if (cleaned) out.push(`User: ${cleaned}`)
      continue
    }
    if (!line.trim() && out.at(-1)?.startsWith('User: ')) continue
    if (out.at(-1) === 'User: ' || (out.at(-1)?.startsWith('User: ') && !line.startsWith('Assistant: ') &&
        !/^(Where it stood|Working directory|Files changed|Conversation|Historical|\[)/.test(line))) {
      const prev = out.pop()!
      const merged = stripContextBlocks(`${prev.slice(6)} ${line}`.trim())
      if (merged) out.push(`User: ${merged}`)
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

/** Tab labels and continuation cards: never show raw context markup from the source title. */
export function handoffSourceTitle(title: string | null | undefined, fallbackUserText?: string | null): string {
  const stripped = title ? stripContextBlocks(title) : ''
  const saved = sanitizeThreadTitle(stripped) ?? (stripped && !isInjectedContextTitle(stripped) ? stripped : '')
  if (saved) return saved.length > 120 ? summarizeUserMessage(saved, 120) : saved
  const fromUser = fallbackUserText ? summarizeUserMessage(fallbackUserText, 120) : ''
  return fromUser || 'Previous chat'
}

/** Synthetic transcript tail for an empty continued chat (preview only; not sent until the user messages). */
export function continuationPreviewItems(previewUser: string | null | undefined, previewAssistant: string | null | undefined): ChatTranscriptItem[] {
  const turnId = 'continuation-preview'
  const items: ChatTranscriptItem[] = []
  const user = previewUser?.trim()
  if (user) items.push({ type: 'user', id: 'continuation-preview-user', turnId, text: user })
  const assistant = previewAssistant?.trim()
  if (assistant) {
    items.push({
      type: 'assistant', id: 'continuation-preview-assistant', turnId, text: assistant,
      phase: 'final_answer', streaming: false
    })
  }
  return items
}

/** First line for thread previews (slightly longer than drawer titles). */
export function firstLineOfUserMessage(text: string, max = 80): string {
  return summarizeUserMessage(text, max)
}
