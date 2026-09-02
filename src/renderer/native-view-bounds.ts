import { useLayoutEffect, useRef } from 'react'
import type { BrowserBounds } from '../shared/types.js'

// Keeping a native WebContentsView aligned with the React box that stands in for it.
//
// The browser pane needs this, including the non-obvious parts learned the hard way:
//
//  - `layoutKey` changes with workspace mode AND agents open/closed. A grid/flex resize does
//    fire ResizeObserver, but re-running the effect after React commits gives an authoritative
//    re-measure and closes the race where the view briefly paints at its previous bounds.
//  - one animation-frame coalesce: chat-split drags and drawer toggles can emit many RO
//    callbacks in one frame; only the latest rect is worth an IPC round-trip.
//  - a trailing in-flight drain plus two settle frames catch post-commit reflow from
//    react-resizable-panels, which can assign pixel sizes a frame after its container changes.
//  - observing ancestors (not only the host) catches layout moves where a sibling rail
//    changes size and the host shifts.
//
// `visible` is authoritative rather than inferred from the rect: main hides the view outright
// when another surface is showing, so no sliver survives a collapsed host.

const SETTLE_FRAMES = 2
const ANCESTOR_OBSERVE_DEPTH = 6

export function boundsEqual(a: BrowserBounds, b: BrowserBounds): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.visible === b.visible
  )
}

export function useNativeViewBounds(
  report: (bounds: BrowserBounds) => void | Promise<void>,
  layoutKey: string | undefined,
  visible: boolean
) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // Held in a ref so an inline reporter does not have to be memoized by every caller: the
  // effect deliberately re-runs only on layout changes, not on the callback's identity.
  const reportRef = useRef(report)
  reportRef.current = report
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return

    let pending: BrowserBounds | null = null
    let lastSent: BrowserBounds | null = null
    let coalesceRaf = 0
    let settleRaf = 0
    let settleLeft = 0
    let inflight = false
    let destroyed = false

    const read = (): BrowserBounds => {
      const rect = host.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible }
    }

    const drain = async (): Promise<void> => {
      if (destroyed || inflight) return
      while (pending && !destroyed) {
        const next = pending
        pending = null
        if (lastSent && boundsEqual(lastSent, next)) continue
        lastSent = next
        inflight = true
        try {
          await reportRef.current(next)
        } finally {
          inflight = false
        }
      }
    }

    const flushCoalesced = (): void => {
      coalesceRaf = 0
      void drain()
    }

    const queueSettle = (): void => {
      settleLeft = SETTLE_FRAMES
      if (settleRaf) return
      const step = (): void => {
        settleRaf = 0
        if (destroyed || settleLeft <= 0) return
        settleLeft -= 1
        pending = read()
        if (!coalesceRaf) coalesceRaf = requestAnimationFrame(flushCoalesced)
        if (settleLeft > 0) settleRaf = requestAnimationFrame(step)
      }
      settleRaf = requestAnimationFrame(step)
    }

    const sync = (): void => {
      pending = read()
      if (!coalesceRaf) coalesceRaf = requestAnimationFrame(flushCoalesced)
      queueSettle()
    }

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(host)
    let ancestor: HTMLElement | null = host.parentElement
    for (let depth = 0; ancestor && depth < ANCESTOR_OBSERVE_DEPTH; depth += 1) {
      observer.observe(ancestor)
      ancestor = ancestor.parentElement
    }
    window.addEventListener('resize', sync)
    return () => {
      destroyed = true
      if (coalesceRaf) cancelAnimationFrame(coalesceRaf)
      if (settleRaf) cancelAnimationFrame(settleRaf)
      observer.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [layoutKey, visible])
  return hostRef
}
