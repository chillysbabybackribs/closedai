export type AppShortcut =
  | 'settings' | 'history' | 'new-chat' | 'close-tab' | 'close-window' | 'toggle-fullscreen' | 'pause-task'
  | 'tools' | 'context' | 'trace' | 'reload' | 'toggle-devtools'

/**
 * Window-level chords the shell owns, matched the same way for every platform key modifier.
 * Chat zoom has its own module; this covers the shell surfaces the title bar menus also open.
 */
export function appShortcutForKey(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>
): AppShortcut | null {
  if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    if (event.key === 'F11') return 'toggle-fullscreen'
    if (event.key === 'F12') return 'toggle-devtools'
    if (event.key === 'Escape') return 'pause-task'
  }
  if (event.altKey || (!event.ctrlKey && !event.metaKey)) return null
  const key = event.key.toLowerCase()
  if (key === 'w') return event.shiftKey ? 'close-window' : 'close-tab'
  if (event.shiftKey) {
    // Agent and Developer menu rows: Ctrl+Shift+letter so they never collide with editing chords.
    if (key === 't') return 'tools'
    if (key === 'k') return 'context'
    if (key === 'i') return 'trace'
    return null
  }
  if (event.key === ',') return 'settings'
  if (key === 'h') return 'history'
  if (key === 'n') return 'new-chat'
  if (key === 'r') return 'reload'
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
