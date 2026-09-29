import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatAttachment } from '../shared/chat.js'

export type ComposerDraft = {
  input: string
  attachments: ChatAttachment[]
  lastModified?: number
}

// Drafts outlive a relaunch: unsent text is kept in localStorage per chat, newest first, bounded.
const STORAGE_KEY = 'closedai.composer.drafts.v1'
const MAX_SAVED_DRAFTS = 50
// A pasted image travels as a data URL; one that large is left out of the saved copy, not the draft.
const MAX_SAVED_ATTACHMENT_CHARS = 64_000
const SAVE_DELAY_MS = 300

let drafts: Map<string, ComposerDraft> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function draftStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

function loaded(): Map<string, ComposerDraft> {
  if (drafts) return drafts
  drafts = new Map()
  const storage = draftStorage()
  if (!storage) return drafts
  try {
    const raw = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as Record<string, ComposerDraft>
    for (const [key, draft] of Object.entries(raw)) {
      if (draft && typeof draft.input === 'string' && Array.isArray(draft.attachments)) drafts.set(key, draft)
    }
  } catch { /* A malformed copy starts empty. */ }
  window.addEventListener('pagehide', saveDrafts)
  return drafts
}

function saveDrafts(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  const storage = draftStorage()
  if (!storage || !drafts) return
  const newest = [...drafts].sort(([, a], [, b]) => (b.lastModified ?? 0) - (a.lastModified ?? 0)).slice(0, MAX_SAVED_DRAFTS)
  const saved = Object.fromEntries(newest.map(([key, draft]) => [key, {
    ...draft, attachments: draft.attachments.filter((attachment) => JSON.stringify(attachment).length <= MAX_SAVED_ATTACHMENT_CHARS)
  }]))
  try { storage.setItem(STORAGE_KEY, JSON.stringify(saved)) } catch { /* Best-effort, like the layout. */ }
}

function scheduleSave(): void {
  if (!draftStorage() || saveTimer) return
  saveTimer = setTimeout(saveDrafts, SAVE_DELAY_MS)
}

export function getComposerDraft(paneId?: string | null): ComposerDraft {
  const key = paneId || 'default'
  const draft = loaded().get(key)
  return draft ? { ...draft, attachments: [...draft.attachments] } : { input: '', attachments: [] }
}

export function setComposerDraft(paneId: string | null | undefined, draft: ComposerDraft): void {
  const key = paneId || 'default'
  if (!draft.input && (!draft.attachments || draft.attachments.length === 0)) {
    loaded().delete(key)
  } else {
    loaded().set(key, { ...draft, attachments: [...draft.attachments], lastModified: Date.now() })
  }
  scheduleSave()
}

export function clearComposerDraft(paneId?: string | null): void {
  const key = paneId || 'default'
  loaded().delete(key)
  scheduleSave()
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
  loaded().clear()
  scheduleSave()
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
