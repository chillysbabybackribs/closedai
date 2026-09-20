import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserShot } from '../shared/types.js'

// DOM surfaces that may paint over the browser column.
// Modal backdrops cover the browser even before async content (such as an image) has
// given the dialog its final size. Native views must also stay behind that backdrop.
const OVERLAY_SELECTOR = '.browser-suggestions, .browser-downloads, [data-slot="dialog-overlay"], [role="dialog"], [role="menu"]'
const BROWSER_HOST_SELECTOR = '#browser-page'
const EAGER_CAPTURE_TRIGGER = '[data-ui="browser.address"], [aria-label="Downloads"], [aria-label="Tools"]'
// Right-clicking browser chrome opens a menu over the page, and unlike the triggers above it
// was reaching apply() with nothing primed — so the still arrived a capture round-trip after
// the native pixels were already hidden. A secondary button never switches tabs, so the shot
// this primes is always of the page the freeze is about to stand in for.
const BROWSER_SURFACE = '[data-ui-surface="browser"]'

export function rectsOverlap(a: DOMRectReadOnly, b: DOMRectReadOnly): boolean {
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
  const browserRect = host.getBoundingClientRect()
  if (browserRect.width < 2 || browserRect.height < 2) return false
  for (const overlay of root.querySelectorAll(OVERLAY_SELECTOR)) {
    if (!overlayIsOpen(overlay)) continue
    const rect = overlay.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue
    if (rectsOverlap(rect, browserRect)) return true
  }
  return false
}

// Electron paints WebContentsView above the renderer, so a DOM overlay cannot literally stack
// over the live page. When an overlay intersects the browser host, prime a one-frame capture,
// show that still in the unchanged browser box, and hide the native pixels while leaving the
// view attached. The native pixels stay visible until the still is ready; hiding them first
// leaves a blank compositor gap while the capture round-trip is in flight. Closing the overlay
// restores the live surface on the same bounds.
export function useTitlebarBrowserFreeze(): {
  open: boolean
  shot: BrowserShot | null
  finishRestore: () => void
} {
  const [freeze, setFreeze] = useState<BrowserShot | null>(null)
  const [open, setOpen] = useState(false)
  const overlayOpen = useRef(false)
  const pending = useRef<Promise<BrowserShot | null> | null>(null)
  const primed = useRef<BrowserShot | null>(null)

  useEffect(() => {
    const capture = (): void => {
      if (pending.current) return
      pending.current = window.closedai.browser.capture()
        .catch(() => null)
        .then((shot) => {
          pending.current = null
          primed.current = shot
          if (shot && overlayOpen.current) {
            setFreeze(shot)
            // Do not occlude the native page until its replacement is available. This matters
            // for large menus, whose final position is only known after their child list mounts.
            setOpen(true)
          }
          return shot
        })
    }
    const apply = (next: boolean): void => {
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
      attributeFilter: ['aria-hidden', 'data-state', 'hidden', 'open'],
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

  // The DOM overlay disappears before the bounds IPC necessarily reaches main. Retain the
  // still until main has made the attached live page visible, so there is no blank handoff.
  const finishRestore = useCallback((): void => {
    if (!overlayOpen.current) setFreeze(null)
  }, [])

  return { open, shot: freeze, finishRestore }
}
