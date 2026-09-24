import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserBounds, BrowserShot } from '../shared/types.js'

// DOM surfaces that may paint over the browser column.
// Modal backdrops cover the browser even before async content (such as an image) has
// given the dialog its final size. Native views must also stay behind that backdrop.
// Omnibox suggestions are handled separately: their list mutates on every keystroke and must
// not drive the generic overlay scanner or the native page occludes/restores in a loop.
const OVERLAY_SELECTOR = '.header-chat-search-popup, .header-chat-search-error, .browser-downloads, [data-slot="dialog-overlay"], [role="dialog"], [role="menu"], [data-slot="tooltip-content"]'
const BROWSER_HOST_SELECTOR = '#browser-page'
const EAGER_CAPTURE_TRIGGER = '[data-ui="titlebar.chat-search"], [data-ui="titlebar.menu"][data-ui-key="view"], [data-ui="browser.address"], [data-ui="browser.saved-sites"], [aria-label="Downloads"], [aria-label="Tools"], [data-ui="layout.browser-drag"], [data-ui="layout.pane-drag"], [data-ui="layout.tab"]'
// Right-clicking browser chrome opens a menu over the page, and unlike the triggers above it
// was reaching apply() with nothing primed — so the still arrived a capture round-trip after
// the native pixels were already hidden. A secondary button never switches tabs, so the shot
// this primes is always of the page the freeze is about to stand in for.
const BROWSER_SURFACE = '[data-ui-surface="browser"]'
// Native WebContentsView pixels can extend a fractional pixel past the renderer's
// measured host edge. Treat overlays that reach the edge as overlapping so their
// shadow and border cannot slip underneath the native page during the handoff.
const NATIVE_VIEW_EDGE_MARGIN = 3

type RectEdges = Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>

export function rectsOverlap(a: RectEdges, b: RectEdges): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export function overlayIsOpen(overlay: Element): boolean {
  if (overlay.hasAttribute('hidden')) return false
  // Radix hides the decorative backdrop from assistive technology while it remains painted.
  if (overlay.getAttribute('aria-hidden') === 'true' && overlay.getAttribute('data-slot') !== 'dialog-overlay') return false
  const state = overlay.getAttribute('data-state')
  if (state === 'closed') return false
  const details = overlay.closest('details')
  return !details || details.open
}

/** Freeze only when an open overlay actually intersects the native browser host. */
export function overlayBlocksBrowser(root: ParentNode = document): boolean {
  const host = root.querySelector(BROWSER_HOST_SELECTOR)
  if (!(host instanceof Element)) return false
  const hostRect = host.getBoundingClientRect()
  const browserRect = {
    left: hostRect.left - NATIVE_VIEW_EDGE_MARGIN,
    right: hostRect.right + NATIVE_VIEW_EDGE_MARGIN,
    top: hostRect.top - NATIVE_VIEW_EDGE_MARGIN,
    bottom: hostRect.bottom + NATIVE_VIEW_EDGE_MARGIN
  }
  if (hostRect.width < 2 || hostRect.height < 2) return false
  for (const overlay of root.querySelectorAll(OVERLAY_SELECTOR)) {
    if (!overlayIsOpen(overlay)) continue
    const rect = overlay.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue
    if (rectsOverlap(rect, browserRect)) return true
  }
  return false
}

// Keep at most one compositor capture in flight. A newer size (or restoration) makes
// its result obsolete; capture the latest request next without holding up bounds IPC.
export function createBrowserFreezeRefresh(
  capture: () => Promise<BrowserShot | null>,
  publish: (shot: BrowserShot) => void
): (bounds: BrowserBounds) => void {
  let latest: BrowserBounds | null = null
  let running = false
  const drain = async (): Promise<void> => {
    running = true
    while (latest) {
      const request = latest
      const shot = await capture().catch(() => null)
      if (latest !== request) continue
      latest = null
      if (shot) publish(shot)
    }
    running = false
  }
  return (bounds) => {
    latest = bounds.visible !== false && bounds.occluded ? bounds : null
    if (latest && !running) void drain()
  }
}

// Electron paints WebContentsView above the renderer, so a DOM overlay cannot literally stack
// over the live page. When an overlay intersects the browser host, prime a one-frame capture,
// show that still in the unchanged browser box, and hide the native pixels while leaving the
// view attached. The native pixels stay visible until the still is ready; hiding them first
// leaves a blank compositor gap while the capture round-trip is in flight. Closing the overlay
// restores the live surface on the same bounds.
export function useTitlebarBrowserFreeze(omniboxCoversPage = false): {
  open: boolean
  shot: BrowserShot | null
  finishRestore: () => void
  refresh: (bounds: BrowserBounds) => void
} {
  const [freeze, setFreeze] = useState<BrowserShot | null>(null)
  const [open, setOpen] = useState(false)
  const overlayOpen = useRef(false)
  const omniboxCoversPageRef = useRef(omniboxCoversPage)
  omniboxCoversPageRef.current = omniboxCoversPage
  const pending = useRef<Promise<BrowserShot | null> | null>(null)
  const primed = useRef<BrowserShot | null>(null)
  const captureRef = useRef<() => void>(() => {})
  const refreshRef = useRef<ReturnType<typeof createBrowserFreezeRefresh> | null>(null)
  if (!refreshRef.current) refreshRef.current = createBrowserFreezeRefresh(
    () => window.closedai.browser.capture(),
    (shot) => {
      if (overlayOpen.current || omniboxCoversPageRef.current) setFreeze(shot)
    }
  )
  const applyRef = useRef<(next: boolean) => void>(() => {})

  useEffect(() => {
    const capture = (): void => {
      if (pending.current) return
      pending.current = window.closedai.browser.capture()
        .catch(() => null)
        .then((shot) => {
          pending.current = null
          primed.current = shot
          if (shot && (overlayOpen.current || omniboxCoversPageRef.current)) {
            setFreeze(shot)
            // Do not occlude the native page until its replacement is available. This matters
            // for large menus, whose final position is only known after their child list mounts.
            setOpen(true)
          }
          return shot
        })
    }
    const apply = (next: boolean): void => {
      if (!next && omniboxCoversPageRef.current) return
      if (next === overlayOpen.current) return
      overlayOpen.current = next
      if (!next) {
        setOpen(false)
        primed.current = null
        return
      }
      if (primed.current) {
        setFreeze(primed.current)
        setOpen(true)
      }
      else capture()
    }
    captureRef.current = capture
    applyRef.current = apply
    const sync = (): void => apply(overlayBlocksBrowser())
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest(EAGER_CAPTURE_TRIGGER)) capture()
      else if (event.button === 2 && target.closest(BROWSER_SURFACE)) capture()
    }
    // Overlays mount inside the browser shell or directly under <body>; a subtree watch on
    // body is cheap here because nothing in this shell streams DOM at token frequency.
    const observer = new MutationObserver(sync)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['aria-hidden', 'data-state', 'hidden', 'open', 'style'],
      childList: true,
      subtree: true
    })
    window.addEventListener('pointerdown', onPointerDown, true)
    sync()
    return () => {
      observer.disconnect()
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [])

  useEffect(() => {
    if (omniboxCoversPage) applyRef.current(true)
    else applyRef.current(overlayBlocksBrowser())
  }, [omniboxCoversPage])

  // The DOM overlay disappears before the bounds IPC necessarily reaches main. Retain the
  // still until main has made the attached live page visible, so there is no blank handoff.
  const finishRestore = useCallback((): void => {
    if (!overlayOpen.current && !omniboxCoversPageRef.current) setFreeze(null)
  }, [])

  return { open, shot: freeze, finishRestore, refresh: refreshRef.current }
}
