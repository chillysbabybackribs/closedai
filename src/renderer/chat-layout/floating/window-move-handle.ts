/** Where a pointer press may start moving a tiled or floating window. */
const CHAT_MOVE_BLOCK = '.chat-layout-tab, .chat-window-controls, .chat-layout-new-chat, .chat-layout-tab-new'
const BROWSER_MOVE_BLOCK = '.browser-tab, .browser-tab-new'

function isElement(target: EventTarget): target is HTMLElement {
  return typeof (target as HTMLElement).closest === 'function'
    && typeof (target as HTMLElement).matches === 'function'
}

export function pressesMoveHandle(event: { target: EventTarget }): boolean {
  const target = event.target
  if (!isElement(target)) return false
  if (target.matches('[data-window-grip]') || target.closest('[data-window-grip]')) return true
  if (target.closest('.browser-tabstrip') && !target.closest(BROWSER_MOVE_BLOCK)) return true
  if (target.closest('.chat-layout-header') && !target.closest(CHAT_MOVE_BLOCK)) return true
  return false
}
