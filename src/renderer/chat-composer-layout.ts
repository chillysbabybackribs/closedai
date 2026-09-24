import type { ChatSnapshot } from '../shared/chat.js'
import type { ChatPeerSummary } from '../shared/chat-peers.js'

/** Per-pane composer anchor: bottom for conversations, center only for genuinely blank chats. */
const composerBottomByPane = new Map<string, boolean>()

export function resetComposerLayoutForTests(): void {
  composerBottomByPane.clear()
}

/** Whether this pane should use the transcript layout (composer pinned to the bottom). */
export function paneHasTranscript(state: ChatSnapshot, peer?: ChatPeerSummary | null): boolean {
  if (state.items.length > 0 || state.activeTurnId) return true
  if (state.history?.hasEarlier) return true
  if (peer?.preview.trim()) return true
  if (peer?.threadId && peer.title.trim() && peer.title !== 'New chat') return true
  return false
}

export function composerAnchoredBottom(paneId: string, state: ChatSnapshot, peer?: ChatPeerSummary | null): boolean {
  if (paneHasTranscript(state, peer)) {
    composerBottomByPane.set(paneId, true)
    return true
  }
  const blank = !state.threadId && !state.history?.hasEarlier && !peer?.preview.trim()
  if (blank) {
    composerBottomByPane.set(paneId, false)
    return false
  }
  return composerBottomByPane.get(paneId) ?? false
}

/**
 * Keep the last painted transcript when a parked or waking pane briefly snapshots empty before
 * replay — the renderer-side counterpart to main's cachedPaneView fill.
 */
export function stabilizePaneSnapshot(next: ChatSnapshot | undefined, previous: ChatSnapshot): ChatSnapshot {
  if (!next) return previous
  if (next.items.length > 0 || next.activeTurnId) return next
  if (next.history?.hasEarlier) return next
  if (previous.items.length === 0) return next
  const nextThread = next.threadId ?? null
  const previousThread = previous.threadId ?? null
  if (nextThread !== null && previousThread !== null && nextThread !== previousThread) return next
  return {
    ...next,
    items: previous.items,
    history: {
      ...next.history,
      hasEarlier: Boolean(next.history?.hasEarlier || previous.history?.hasEarlier)
    },
    threadName: next.threadName ?? previous.threadName,
    contextUsage: next.contextUsage ?? previous.contextUsage
  }
}
