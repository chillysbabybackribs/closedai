/**
 * Zoom level for the embedded page, as a whole percent so it reads the same way as the
 * chat pane's zoom (see chat-zoom.ts) and can be shown to the user without conversion.
 *
 * Scope note: the level lives on the BrowserTab, in memory. It is per-tab because that
 * is what a browser does — zooming a cramped dashboard must not enlarge every other tab
 * — and it is not persisted because there is no per-origin store to key it by; a
 * restart returns to 100%.
 */

export const BROWSER_ZOOM_DEFAULT = 100
export const BROWSER_ZOOM_MIN = 50
export const BROWSER_ZOOM_MAX = 250
export const BROWSER_ZOOM_STEP = 10

export function clampBrowserZoom(value: number): number {
  if (!Number.isFinite(value)) return BROWSER_ZOOM_DEFAULT
  const stepped = Math.round(value / BROWSER_ZOOM_STEP) * BROWSER_ZOOM_STEP
  return Math.min(BROWSER_ZOOM_MAX, Math.max(BROWSER_ZOOM_MIN, stepped))
}

/** Chromium's setZoomFactor takes a multiplier, not a percent. */
export function browserZoomFactor(percent: number): number {
  return clampBrowserZoom(percent) / 100
}

/**
 * Sentinel the injected page script uses to report a zoom gesture to main. Deliberately
 * app-namespaced so an ordinary page log can never be mistaken for one.
 */
export const BROWSER_ZOOM_MESSAGE_PREFIX = '__codeapp_zoom:'

/**
 * Reads a direction out of a page console line, or 0 when the line is not ours.
 *
 * Strict about the payload because this arrives from the page: any page can print this
 * string. The blast radius is a page zooming its own tab, which the user can undo with
 * the same gesture — but there is no reason to accept anything except the exact two
 * values the script emits.
 */
export function parseZoomMessage(message: string): -1 | 0 | 1 {
  if (!message.startsWith(BROWSER_ZOOM_MESSAGE_PREFIX)) return 0
  const payload = message.slice(BROWSER_ZOOM_MESSAGE_PREFIX.length)
  if (payload === '1') return 1
  if (payload === '-1') return -1
  return 0
}
