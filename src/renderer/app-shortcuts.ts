export type AppShortcut =
  | 'settings' | 'history' | 'new-chat' | 'close-tab' | 'close-window' | 'toggle-fullscreen' | 'pause-task'
  | 'tools' | 'trace' | 'reload' | 'toggle-devtools' | 'open-coordinator' | 'stop-coordinator-crew'

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
    if (key === 'i') return 'trace'
    if (key === 'c') return 'open-coordinator'
    if (key === 'x') return 'stop-coordinator-crew'
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

/** The focused element as the Escape decision needs it; a plain object in tests. */
export type EscapeFocusTarget = {
  tagName: string
  isContentEditable?: boolean
  getAttribute: (name: string) => string | null
} | null

export type EscapeContext = {
  /** A dialog, menu, or popover is open; it owns Escape. */
  overlayOpen: boolean
  /** `document.activeElement` at the keypress. */
  activeElement: EscapeFocusTarget
  /** A maximized (solo) tile is showing; Escape restores the grid. */
  soloActive: boolean
  /** A tile drag or divider resize is in progress; Escape cancels it. */
  layoutBusy: boolean
}

/**
 * Whether an unmodified Escape should pause the running task rather than be left to whatever
 * closer owner is listening. Every editable control except the composer textarea keeps Escape
 * (search fields clear, the omnibox restores the URL, editors close completions), and layout
 * modes that already answer Escape — a maximized tile, a drag, a divider resize — come first.
 */
export function escapePausesTask(context: EscapeContext): boolean {
  if (context.overlayOpen || context.soloActive || context.layoutBusy) return false
  const active = context.activeElement
  if (!active) return true
  if (active.getAttribute('data-ui') === 'composer.input') return true
  const tag = active.tagName.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false
  const editable = active.getAttribute('contenteditable')
  return !(active.isContentEditable || (editable !== null && editable !== 'false'))
}
