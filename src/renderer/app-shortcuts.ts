export type AppShortcut = 'settings' | 'history' | 'new-chat' | 'close-window' | 'toggle-fullscreen' | 'pause-task'

/**
 * Window-level chords the shell owns, matched the same way for every platform key modifier.
 * Chat zoom has its own module; this covers the shell surfaces the title bar menu also opens.
 */
export function appShortcutForKey(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>
): AppShortcut | null {
  if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    if (event.key === 'F11') return 'toggle-fullscreen'
    if (event.key === 'Escape') return 'pause-task'
  }
  if (event.altKey || event.shiftKey || (!event.ctrlKey && !event.metaKey)) return null
  if (event.key === ',') return 'settings'
  if (event.key.toLowerCase() === 'h') return 'history'
  if (event.key.toLowerCase() === 'n') return 'new-chat'
  if (event.key.toLowerCase() === 'w') return 'close-window'
  return null
}

/**
 * Identify which chat pane has a running task that Escape should pause.
 * Prefers the selected pane if it is currently running, otherwise finds
 * any active pane with a running turn.
 */
export function targetRunningPaneId(
  selectedPaneId: string,
  selectedActiveTurnId: string | null | undefined,
  panes?: Record<string, { activeTurnId?: string | null }> | null
): string | null {
  if (selectedActiveTurnId) return selectedPaneId
  if (!panes) return null
  for (const [paneId, snapshot] of Object.entries(panes)) {
    if (snapshot?.activeTurnId) return paneId
  }
  return null
}
