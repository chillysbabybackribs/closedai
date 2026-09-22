import type { ChatTranscriptItem } from '../../shared/chat.js'
import type { AdditionalContext } from './turn-context.js'
import { buildThreadHandoff } from './thread-handoff.js'

// Re-seed compaction for CLI providers with no native compact verb (Antigravity today; Cursor
// later). The app drops the provider conversation handle and injects a bounded transcript
// summary on the next turn so the CLI starts fresh with smaller context.

/** Upper bound on prose carried into a compaction seed; head/tail retention lives in handoff. */
export const COMPACTION_TRANSCRIPT_LIMIT = 120_000

export const COMPACTED_CONTEXT = 'closedai.chat.compacted'

/** Digest for re-seeding a provider thread; null when the transcript has nothing to carry. */
export function buildCompactionSeed(items: ChatTranscriptItem[], threadName: string | null): string | null {
  const handoff = buildThreadHandoff(items, threadName, null, {
    maxChars: COMPACTION_TRANSCRIPT_LIMIT,
    framing: 'compaction'
  })
  return handoff?.text ?? null
}

const COMPACTED_ENVELOPE_TAG = /<(\/?)compacted_conversation_context\b/gi

/** Same rule as the outer envelope: transcript prose may quote this tag, so only the app closes it. */
export function wrapCompactedContext(summary: string): string {
  const body = summary.replace(COMPACTED_ENVELOPE_TAG, '&lt;$1compacted_conversation_context')
  return ['<compacted_conversation_context>', body, '</compacted_conversation_context>'].join('\n')
}

export function compactedAdditionalContext(summary: string): AdditionalContext {
  return { [COMPACTED_CONTEXT]: { kind: 'untrusted', value: wrapCompactedContext(summary) } }
}
