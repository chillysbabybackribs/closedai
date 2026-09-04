import type { ChatPaneId } from '../../shared/chat-peers.js'

/** Delay before warming a pane the user has settled on — avoids paying for scroll-through. */
export const PANE_WARM_DWELL_MS = 1_500

let pendingWarm: ReturnType<typeof setTimeout> | null = null

/** After the user stays on a pane, start its provider warm path without blocking the UI. */
export function schedulePaneWarm(
  paneId: ChatPaneId,
  warm: (paneId: ChatPaneId) => Promise<void>,
  dwellMs: number = PANE_WARM_DWELL_MS
): void {
  if (pendingWarm) {
    clearTimeout(pendingWarm)
    pendingWarm = null
  }
  pendingWarm = setTimeout(() => {
    pendingWarm = null
    void warm(paneId).catch(() => undefined)
  }, dwellMs)
  pendingWarm.unref?.()
}

export function cancelPaneWarm(): void {
  if (pendingWarm) {
    clearTimeout(pendingWarm)
    pendingWarm = null
  }
}
