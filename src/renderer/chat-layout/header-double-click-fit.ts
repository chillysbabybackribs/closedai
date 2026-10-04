/** Shell application title bar (File / View / … and window controls), not chat card headers. */
const SHELL_TITLEBAR_FIT_SKIP = [
  '.titlebar-start',
  '.titlebar-nav-menu',
  '.titlebar-menu-content',
  '.shell-window-controls',
  '.shell-window-control'
].join(',')

/** Controls that keep their own click/double-click behavior on window headers. */
const HEADER_FIT_SKIP = [
  '.chat-window-controls',
  '.chat-layout-tab-close',
  '.browser-tab-close',
  '.chat-layout-new-chat',
  '.chat-layout-tab-new',
  '.browser-tab-new',
  '[data-ui="layout.card-pin"]'
].join(',')

function isElement(target: EventTarget | null): target is HTMLElement {
  return typeof (target as HTMLElement | null)?.closest === 'function'
}

export function shouldHeaderDoubleClickFit(target: EventTarget | null): boolean {
  if (!isElement(target)) return false
  return !target.closest(HEADER_FIT_SKIP)
}

export function shouldShellTitlebarDoubleClickFit(target: EventTarget | null): boolean {
  if (!isElement(target)) return false
  return !target.closest(SHELL_TITLEBAR_FIT_SKIP)
}

/** Capture-phase handler: the full header strip fits/maximizes/cycles except window chrome buttons. */
export function handleHeaderDoubleClickFit(event: { target: EventTarget | null; preventDefault: () => void; stopPropagation: () => void }, onFit: () => void): void {
  if (!shouldHeaderDoubleClickFit(event.target)) return
  event.preventDefault()
  event.stopPropagation()
  onFit()
}

export function handleShellTitlebarDoubleClickFit(event: { target: EventTarget | null; preventDefault: () => void; stopPropagation: () => void }, onFit: () => void): void {
  if (!shouldShellTitlebarDoubleClickFit(event.target)) return
  event.preventDefault()
  event.stopPropagation()
  onFit()
}
