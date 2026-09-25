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
//
// The dragged tile becomes a placeholder at its destination. Its body keeps the size it had
// before the drag and is shown scaled down inside it (a miniature, so nothing reflows);
// when the placeholder is released the body glides from that miniature to fill the tile.

export const GLIDE_MS = 190
const GLIDE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const EPSILON = 0.5
const MOVING = '.chat-layout-tile, [data-ui="layout.divider"]'
const BODY = ':scope > .chat-layout-tile-body'
/** Largest miniature scale, and the share of the placeholder a miniature may fill. */
const MINI_MAX_SCALE = 0.5
const MINI_FIT = 0.6

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

export type Miniature = { layout: Rect; scale: number }

/**
 * A body of `source` size centred in a placeholder of `placeholder` size, scaled about its
 * centre. Sizes are the tile's inner box; the layout rect is relative to that box.
 */
export function miniature(placeholder: { width: number; height: number }, source: { width: number; height: number }): Miniature {
  const fit = Math.min(placeholder.width / source.width, placeholder.height / source.height)
  const scale = Math.max(0.05, Math.min(MINI_MAX_SCALE, fit * MINI_FIT))
  return {
    layout: { x: (placeholder.width - source.width) / 2, y: (placeholder.height - source.height) / 2, width: source.width, height: source.height },
    scale
  }
}

/** Where a box scaled about its centre appears. */
export function centreScaled(layout: Rect, scale: number): Rect {
  const width = layout.width * scale
  const height = layout.height * scale
  return { x: layout.x + (layout.width - width) / 2, y: layout.y + (layout.height - height) / 2, width, height }
}

/** Keyframes playing a glide back to identity; `opacity` also fades a body in from that value. */
export function glideKeyframes(glide: Glide, opacity?: number): Keyframe[] {
  const fade = opacity === undefined ? [{}, {}] : [{ opacity }, { opacity: 1 }]
  return [
    { transformOrigin: '0 0', transform: `translate(${glide.dx}px, ${glide.dy}px) scale(${glide.sx}, ${glide.sy})`, ...fade[0] },
    { transformOrigin: '0 0', transform: 'none', ...fade[1] }
  ]
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
  const miniatures = useRef(new WeakMap<Element, { rect: Rect; opacity: number }>())
  const running = useRef(new Map<Element, Animation>())
  const play = (element: HTMLElement, keyframes: Keyframe[]): void => {
    const animation = element.animate(keyframes, { duration: GLIDE_MS, easing: GLIDE_EASING })
    running.current.set(element, animation)
    // Released through the promise, not events, so whenIdle never re-awaits a landed glide.
    const release = (): void => { if (running.current.get(element) === animation) running.current.delete(element) }
    animation.finished.then(release, release)
  }
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const animate = armed() && !reducedMotion()
    for (const tile of canvas.querySelectorAll<HTMLElement>('.chat-layout-tile')) {
      const body = tile.querySelector<HTMLElement>(BODY)
      if (!body) continue
      const mode = tile.dataset.dragPlaceholder
      const layout = mode ? inlineRect(body) : null
      if (layout) {
        // A fill glide from an earlier drop would otherwise override the miniature's transform.
        running.current.get(body)?.cancel()
        const scale = parseFloat(body.style.getPropertyValue('--mini-scale'))
        miniatures.current.set(body, { rect: centreScaled(layout, Number.isFinite(scale) ? scale : 1), opacity: mode === 'mini' ? 1 : 0 })
        continue
      }
      const shown = miniatures.current.get(body)
      if (!shown) continue
      miniatures.current.delete(body)
      running.current.get(body)?.cancel()
      if (!animate || typeof body.animate !== 'function') continue
      const glide = glideFrom(shown.rect, { x: 0, y: 0, width: body.offsetWidth, height: body.offsetHeight })
      play(body, glide ? glideKeyframes(glide, shown.opacity) : [{ opacity: shown.opacity }, { opacity: 1 }])
    }
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
      play(element, glideKeyframes(glide))
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
