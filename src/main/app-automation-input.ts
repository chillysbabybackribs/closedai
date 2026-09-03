import type { BrowserWindow, WebContents } from 'electron'
import type { ViewportPoint } from './cdp/page-control/types.js'

export type AppInputWindow = Pick<BrowserWindow, 'focus'>
export type AppInputContents = Pick<WebContents, 'focus' | 'sendInputEvent'>

/**
 * Deliver a real Electron click to the app renderer. CDP remains responsible for semantic
 * targeting and hit-testing; Electron input is used for activation because it follows the
 * focused BrowserWindow path that real app controls expect.
 */
export function dispatchAppClick(
  window: AppInputWindow,
  contents: AppInputContents,
  point: ViewportPoint
): void {
  window.focus()
  contents.focus()
  contents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
  contents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  contents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
}
