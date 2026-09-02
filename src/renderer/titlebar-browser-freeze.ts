import { useEffect, useRef, useState } from 'react'
import type { BrowserShot } from '../shared/types.js'

// DOM surfaces that may paint over the browser column.
const OVERLAY_SELECTOR = '.browser-downloads, [role="dialog"], [role="menu"]'
const BROWSER_HOST_SELECTOR = '#browser-page'
const EAGER_CAPTURE_TRIGGER = '[aria-label="Downloads"]'

export function rectsOverlap(a: DOMRectReadOnly, b: DOMRectReadOnly): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export function overlayIsOpen(overlay: Element): boolean {
  if (overlay.hasAttribute('hidden') || overlay.getAttribute('aria-hidden') === 'true') return false
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
// show that still in the unchanged browser box, and detach the native view. Closing the
// overlay restores the live surface on the same bounds.
export function useTitlebarBrowserFreeze(): { open: boolean; shot: BrowserShot | null } {
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
          if (shot && overlayOpen.current) setFreeze(shot)
          return shot
        })
    }
    const apply = (next: boolean): void => {
      if (next === overlayOpen.current) return
      overlayOpen.current = next
      // Detach the native view immediately; waiting for the still lets Chromium composite
      // above the first frames of the overlay.
      setOpen(next)
      if (!next) {
        setFreeze(null)
        primed.current = null
        return
      }
      if (primed.current) setFreeze(primed.current)
      else capture()
    }
    const sync = (): void => apply(overlayBlocksBrowser())
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest(EAGER_CAPTURE_TRIGGER)) capture()
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

  return { open, shot: freeze }
}
