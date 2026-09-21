import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatAttachment } from '../shared/chat.js'

export type ComposerDraft = {
  input: string
  attachments: ChatAttachment[]
  lastModified?: number
}

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

type DraftInjection = { key: string; input: string }
const injectionListeners = new Set<(injection: DraftInjection) => void>()

/**
 * Put text into a pane's composer from outside it (a dialog handing the chat something to do).
 * Existing text is kept above it; the mounted composer for that pane updates at once.
 */
export function injectComposerDraft(paneId: string | null | undefined, text: string): void {
  const key = paneId || 'default'
  const current = getComposerDraft(paneId)
  const input = current.input.trim() ? `${current.input.replace(/\s+$/, '')}\n\n${text}` : text
  setComposerDraft(paneId, { input, attachments: current.attachments })
  for (const listener of injectionListeners) listener({ key, input })
}

export function resetAllComposerDrafts(): void {
  drafts.clear()
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

  useEffect(() => {
    const listener = (injection: DraftInjection): void => {
      if (injection.key === (activePaneRef.current || 'default')) setInputState(injection.input)
    }
    injectionListeners.add(listener)
    return () => { injectionListeners.delete(listener) }
  }, [])

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
