import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import type { Rect } from './layout-tree.js'

// Tiles glide between drag-preview layouts instead of snapping. Each preview is laid out
// once at its final geometry; the move is an inverted transform played back to identity
// (FLIP), so Chromium composites the glide without reflowing transcripts every frame.
//
// A glide in flight is retargeted from where the tile currently appears, read back from
// its running transform, so a preview that changes mid-flight bends instead of jumping.
// Transforms do not fire ResizeObserver: the caller keeps the native browser view
// occluded until `whenIdle` resolves, then re-measures the settled box.

export const GLIDE_MS = 190
const GLIDE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const EPSILON = 0.5
const MOVING = '.chat-layout-tile, [data-ui="layout.divider"]'

export type Glide = { dx: number; dy: number; sx: number; sy: number }

export function movedRect(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) >= EPSILON || Math.abs(a.y - b.y) >= EPSILON
    || Math.abs(a.width - b.width) >= EPSILON || Math.abs(a.height - b.height) >= EPSILON
}

/** The transform that paints `to`'s box where `from` was; null when they already coincide. */
export function glideFrom(from: Rect, to: Rect): Glide | null {
  if (to.width <= 0 || to.height <= 0 || from.width <= 0 || from.height <= 0) return null
  if (!movedRect(from, to)) return null
  return { dx: from.x - to.x, dy: from.y - to.y, sx: from.width / to.width, sy: from.height / to.height }
}

/** Where a box laid out at `layout` appears under a top-left-origin 2D transform. */
export function appearedRect(layout: Rect, matrix: { a: number; d: number; e: number; f: number }): Rect {
  return { x: layout.x + matrix.e, y: layout.y + matrix.f, width: layout.width * matrix.a, height: layout.height * matrix.d }
}

/** Layout rect from the inline geometry React and the split-resize painter write. */
export function inlineRect(element: HTMLElement): Rect | null {
  const { left, top, width, height } = element.style
  const rect = { x: parseFloat(left), y: parseFloat(top), width: parseFloat(width), height: parseFloat(height) }
  return Object.values(rect).every(Number.isFinite) ? rect : null
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function currentRect(element: HTMLElement, layout: Rect, running: Animation | undefined): Rect {
  if (!running || typeof DOMMatrixReadOnly === 'undefined') return layout
  const transform = getComputedStyle(element).transform
  return !transform || transform === 'none' ? layout : appearedRect(layout, new DOMMatrixReadOnly(transform))
}

/**
 * Animate canvas tiles and dividers whenever a commit moves them while `armed()` holds.
 * Every commit records each element's layout rect, armed or not, so the first armed
 * change starts from the geometry actually on screen.
 */
export function useLayoutGlide(canvasRef: RefObject<HTMLElement | null>, armed: () => boolean) {
  const laidOut = useRef(new WeakMap<Element, Rect>())
  const running = useRef(new Map<Element, Animation>())
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const animate = armed() && !reducedMotion()
    for (const element of canvas.querySelectorAll<HTMLElement>(MOVING)) {
      const next = inlineRect(element)
      if (!next) continue
      const previous = laidOut.current.get(element)
      laidOut.current.set(element, next)
      // A commit that leaves this box in place (a streamed token) keeps its glide running.
      if (!previous || !movedRect(previous, next)) continue
      const inFlight = running.current.get(element)
      if (!animate || element.hidden || typeof element.animate !== 'function') {
        inFlight?.finish()
        continue
      }
      // The box moved, so any glide in flight inverts a stale layout: always replace it,
      // even when the tile already appears at its new place and needs no further glide.
      const glide = glideFrom(currentRect(element, previous, inFlight), next)
      inFlight?.cancel()
      if (!glide) continue
      const animation = element.animate([
        { transformOrigin: '0 0', transform: `translate(${glide.dx}px, ${glide.dy}px) scale(${glide.sx}, ${glide.sy})` },
        { transformOrigin: '0 0', transform: 'none' }
      ], { duration: GLIDE_MS, easing: GLIDE_EASING })
      running.current.set(element, animation)
      // Released through the promise, not events, so whenIdle never re-awaits a landed glide.
      const release = (): void => { if (running.current.get(element) === animation) running.current.delete(element) }
      animation.finished.then(release, release)
    }
  })
  /** Resolve once every glide in flight has landed or been cancelled. */
  const whenIdle = useCallback(async (): Promise<void> => {
    while (running.current.size) {
      await Promise.all([...running.current.values()].map((animation) => animation.finished.catch(() => undefined)))
    }
  }, [])
  return whenIdle
}
