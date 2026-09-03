export type AppShortcut = 'settings' | 'history'

/**
 * Window-level chords the shell owns, matched the same way for every platform key modifier.
 * Chat zoom has its own module; this covers the shell surfaces the title bar menu also opens.
 */
export function appShortcutForKey(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey'>
): AppShortcut | null {
  if (event.altKey || (!event.ctrlKey && !event.metaKey)) return null
  if (event.key === ',') return 'settings'
  if (event.key.toLowerCase() === 'h') return 'history'
  return null
}
