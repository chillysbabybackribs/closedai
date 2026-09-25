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
//  - a trailing in-flight drain plus two settle frames catch post-commit layout reflow.
//  - observing ancestors (not only the host) catches layout moves where a sibling rail
//    changes size and the host shifts.
//  - a finite transform animation on the host or an ancestor (a layout tile gliding to its
//    new place) makes the client rect transitional, and landing fires no ResizeObserver:
//    reads wait for the glide to land, then re-measure the settled box.
//  - a drag placeholder shows its tile as a scaled miniature that keeps the pre-drag size, so
//    the page keeps its bounds until the release glide fills the tile.
//  - a zoomed-out space (`data-native-bounds-hold`) is the whole workspace scaled down; its page
//    keeps its full-size bounds behind the still, and the hold lifts with the occlusion.
//
// `visible` is authoritative rather than inferred from the rect: main hides the view outright
// when another surface is showing, so no sliver survives a collapsed host.

const SETTLE_FRAMES = 2
// Host to tile: frame, shell, pane, browser column, dock frame, tile body, tile.
const ANCESTOR_OBSERVE_DEPTH = 7

export function boundsEqual(a: BrowserBounds, b: BrowserBounds): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.visible === b.visible &&
    a.occluded === b.occluded
  )
}

/** Finite transform animations moving `host` or its observed ancestors. */
export function transformGlides(host: Element): Animation[] {
  const glides: Animation[] = []
  let element: Element | null = host
  for (let depth = 0; element && depth <= ANCESTOR_OBSERVE_DEPTH; depth += 1) {
    for (const animation of element.getAnimations?.() ?? []) {
      const effect = animation.effect as KeyframeEffect | null
      if (animation.playState === 'finished' || !effect?.getKeyframes) continue
      if (effect.getComputedTiming().endTime === Infinity) continue
      if (effect.getKeyframes().some((frame) => 'transform' in frame)) glides.push(animation)
    }
    element = element.parentElement
  }
  return glides
}

export function useNativeViewBounds(
  report: (bounds: BrowserBounds) => void | Promise<void>,
  layoutKey: string | undefined,
  visible: boolean,
  occluded = false
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
    let awaitingLanding = false

    const read = (): BrowserBounds => {
      const rect = host.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible, occluded }
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
        if (transformGlides(host).length) { sync(); return }
        pending = read()
        if (!coalesceRaf) coalesceRaf = requestAnimationFrame(flushCoalesced)
        if (settleLeft > 0) settleRaf = requestAnimationFrame(step)
      }
      settleRaf = requestAnimationFrame(step)
    }

    const sync = (): void => {
      if (host.closest('[data-drag-placeholder], [data-native-bounds-hold]')) return
      const glides = transformGlides(host)
      if (glides.length) {
        if (awaitingLanding) return
        awaitingLanding = true
        void Promise.all(glides.map((glide) => glide.finished.catch(() => undefined))).then(() => {
          awaitingLanding = false
          if (!destroyed) sync()
        })
        return
      }
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
    window.addEventListener('scroll', sync, true)
    return () => {
      destroyed = true
      if (coalesceRaf) cancelAnimationFrame(coalesceRaf)
      if (settleRaf) cancelAnimationFrame(settleRaf)
      observer.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [layoutKey, visible, occluded])
  return hostRef
}
