import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatAttachment } from '../shared/chat.js'

export type ComposerDraft = {
  input: string
  attachments: ChatAttachment[]
  lastModified?: number
}

export const DRAFT_WARN_TOKENS = 10_000
export const DRAFT_CRITICAL_TOKENS = 25_000

const drafts = new Map<string, ComposerDraft>()

export function getComposerDraft(paneId?: string | null): ComposerDraft {
  const key = paneId || 'default'
  const draft = drafts.get(key)
  return draft ? { ...draft, attachments: [...draft.attachments] } : { input: '', attachments: [] }
}

export function setComposerDraft(paneId: string | null | undefined, draft: ComposerDraft): void {
  const key = paneId || 'default'
  if (!draft.input && (!draft.attachments || draft.attachments.length === 0)) {
    drafts.delete(key)
  } else {
    drafts.set(key, { ...draft, attachments: [...draft.attachments], lastModified: Date.now() })
  }
}

export function clearComposerDraft(paneId?: string | null): void {
  const key = paneId || 'default'
  drafts.delete(key)
}

export function resetAllComposerDrafts(): void {
  drafts.clear()
}

/** Fast token estimate: 4 characters per token for text, plus base estimate for attachments. */
export function estimateDraftTokens(input: string, attachments: ChatAttachment[] = []): number {
  const textTokens = input.length > 0 ? Math.ceil(input.length / 4) : 0
  const attachmentTokens = attachments.reduce((sum, att) => {
    if (att.kind === 'image') return sum + 1000
    return sum + 250
  }, 0)
  return textTokens + attachmentTokens
}

export type DraftTokenLevel = 'normal' | 'warn' | 'critical'

export function getDraftTokenStatus(
  tokens: number,
  contextWindow?: number | null,
  usedTokens?: number | null
): {
  level: DraftTokenLevel
  formattedTokens: string
  label: string
  tooltip: string
} {
  const formatted = tokens >= 1_000 ? `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}k` : String(tokens)
  let level: DraftTokenLevel = 'normal'
  let label = `≈${formatted} tokens`
  let tooltip = `Estimated prompt size: ≈${tokens.toLocaleString()} tokens`

  const remainingWindow = (contextWindow && usedTokens != null) ? Math.max(0, contextWindow - usedTokens) : null

  if (remainingWindow !== null && tokens > remainingWindow) {
    level = 'critical'
    label = `≈${formatted} tokens · Exceeds context`
    tooltip = `Estimated prompt (${tokens.toLocaleString()} tokens) exceeds available context headroom (${remainingWindow.toLocaleString()} tokens remaining)`
  } else if (tokens >= DRAFT_CRITICAL_TOKENS) {
    level = 'critical'
    label = `≈${formatted} tokens · Very large`
    tooltip = `Estimated prompt (${tokens.toLocaleString()} tokens) is very large. Responses may take longer or encounter rate limits.`
  } else if (tokens >= DRAFT_WARN_TOKENS) {
    level = 'warn'
    label = `≈${formatted} tokens · Large prompt`
    tooltip = `Estimated prompt (${tokens.toLocaleString()} tokens) is large. Consider breaking into smaller steps if necessary.`
  }

  return { level, formattedTokens: formatted, label, tooltip }
}

export function useComposerDraft(paneId?: string | null): {
  input: string
  setInput: (valOrUpdater: string | ((curr: string) => string)) => void
  attachments: ChatAttachment[]
  setAttachments: (valOrUpdater: ChatAttachment[] | ((curr: ChatAttachment[]) => ChatAttachment[])) => void
  clearDraft: () => void
} {
  const [input, setInputState] = useState(() => getComposerDraft(paneId).input)
  const [attachments, setAttachmentsState] = useState<ChatAttachment[]>(() => getComposerDraft(paneId).attachments)
  const activePaneRef = useRef(paneId)

  useEffect(() => {
    if (activePaneRef.current !== paneId) {
      activePaneRef.current = paneId
      const draft = getComposerDraft(paneId)
      setInputState(draft.input)
      setAttachmentsState(draft.attachments)
    }
  }, [paneId])

  const setInput = useCallback((valOrUpdater: string | ((curr: string) => string)) => {
    setInputState((prev) => {
      const next = typeof valOrUpdater === 'function' ? valOrUpdater(prev) : valOrUpdater
      setComposerDraft(activePaneRef.current, { input: next, attachments: getComposerDraft(activePaneRef.current).attachments })
      return next
    })
  }, [])

  const setAttachments = useCallback((valOrUpdater: ChatAttachment[] | ((curr: ChatAttachment[]) => ChatAttachment[])) => {
    setAttachmentsState((prev) => {
      const next = typeof valOrUpdater === 'function' ? valOrUpdater(prev) : valOrUpdater
      setComposerDraft(activePaneRef.current, { input: getComposerDraft(activePaneRef.current).input, attachments: next })
      return next
    })
  }, [])

  const clearDraft = useCallback(() => {
    clearComposerDraft(activePaneRef.current)
    setInputState('')
    setAttachmentsState([])
  }, [])

  return {
    input,
    setInput,
    attachments,
    setAttachments,
    clearDraft
  }
}
