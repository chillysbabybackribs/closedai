import type { WebContents } from 'electron'
import {
  BROWSER_ZOOM_DEFAULT,
  BROWSER_ZOOM_MESSAGE_PREFIX,
  BROWSER_ZOOM_STEP,
  browserZoomFactor,
  clampBrowserZoom,
  parseZoomMessage
} from '../shared/browser-zoom.js'

/**
 * Alt+wheel zoom for one embedded page, kept out of BrowserTab so the tab keeps its
 * navigation/CDP focus and does not grow for a self-contained input concern.
 *
 * The gesture is split across the process boundary because neither side can do both
 * halves: only the page sees the wheel delta, and only main can change the zoom
 * (`setZoomFactor` is a WebContents-level API). So the page decides the direction and
 * cancels the scroll; main applies the zoom.
 *
 * WHY THE PAGE REPORTS OVER `console-message` — the three alternatives were measured,
 * not assumed (see docs/agent-optimizations.md #60):
 *
 *  - `webContents.on('input-event')` looked ideal and is a TRAP: it fires for
 *    `mouseWheel` and carries `modifiers: ['alt']`, but it emits only the base
 *    InputEvent — there is NO `deltaY`. It can report that an Alt+wheel happened and
 *    never which way, so it cannot drive a zoom at all.
 *  - A dedicated preload cannot be used: browser tabs run `sandbox: true`, and
 *    sandboxed preloads must be CommonJS while this repo's preload output is ESM
 *    (`.mjs`).
 *  - A CDP `Runtime.addBinding` channel would force a debugger attach on every
 *    ordinary browsing tab, reversing the lazy-attach doctrine in browser-tab.ts.
 *
 * `console-message` needs no debugger, no preload and no build change, and was verified
 * to deliver `console.debug` (level `verbose`) from a sandboxed page. A page can of
 * course print the sentinel itself; the worst it achieves is zooming its own tab, which
 * the user reverses with the same gesture.
 */

/**
 * Injected per document. The modifier test mirrors wheel-zoom.ts rather than importing
 * it — this runs as a string inside the page. wheel-zoom.ts stays the source of truth.
 */
const ZOOM_GESTURE_SCRIPT = `
(() => {
  if (window.__codeappZoomInstalled) return
  window.__codeappZoomInstalled = true
  // Bound at inject time so a page that later replaces console.* cannot silently break
  // the channel. debug/verbose keeps it out of the page's default console view.
  const report = console.debug.bind(console)
  // Capture phase so the page's own wheel handlers cannot beat us to it, and explicitly
  // non-passive because Chromium defaults window wheel listeners to passive, where
  // preventDefault is a silent no-op and the page would scroll while zooming.
  window.addEventListener('wheel', (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (!event.deltaY) return
    event.preventDefault()
    report('${BROWSER_ZOOM_MESSAGE_PREFIX}' + (event.deltaY < 0 ? '1' : '-1'))
  }, { capture: true, passive: false })
})()
`

/**
 * Wires the gesture onto a tab's WebContents. Per-tab state, matching what a browser
 * does: zooming a cramped dashboard must not enlarge every other tab.
 */
export function installTabZoom(contents: WebContents): void {
  let zoomPercent = BROWSER_ZOOM_DEFAULT

  const apply = (): void => {
    if (contents.isDestroyed()) return
    contents.setZoomFactor(browserZoomFactor(zoomPercent))
  }

  contents.on('console-message', (details) => {
    // The script reports at debug/verbose, so nothing else on the page can be mistaken
    // for it even before the sentinel is parsed.
    if (details.level !== 'debug') return
    const direction = parseZoomMessage(details.message)
    if (direction === 0) return
    // Clamp before comparing, so wheeling past either end is a no-op rather than a
    // stream of redundant applies.
    const next = clampBrowserZoom(zoomPercent + direction * BROWSER_ZOOM_STEP)
    if (next === zoomPercent) return
    zoomPercent = next
    apply()
  })

  // Chromium drops the zoom factor on a cross-origin navigation, and each new document
  // needs its own listener, so both are re-established per completed load.
  contents.on('did-finish-load', () => {
    apply()
    void contents.executeJavaScript(ZOOM_GESTURE_SCRIPT, true).catch(() => {})
  })
}
