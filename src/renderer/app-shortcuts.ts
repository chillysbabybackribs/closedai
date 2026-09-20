export type AppShortcut = 'settings' | 'history' | 'new-chat' | 'close-window' | 'toggle-fullscreen'

/**
 * Window-level chords the shell owns, matched the same way for every platform key modifier.
 * Chat zoom has its own module; this covers the shell surfaces the title bar menu also opens.
 */
export function appShortcutForKey(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>
): AppShortcut | null {
  if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'F11') {
    return 'toggle-fullscreen'
  }
  if (event.altKey || event.shiftKey || (!event.ctrlKey && !event.metaKey)) return null
  if (event.key === ',') return 'settings'
  if (event.key.toLowerCase() === 'h') return 'history'
  if (event.key.toLowerCase() === 'n') return 'new-chat'
  if (event.key.toLowerCase() === 'w') return 'close-window'
  return null
}
