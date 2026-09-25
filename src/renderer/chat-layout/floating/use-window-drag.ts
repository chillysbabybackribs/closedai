import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { layoutTileElement } from '../layout-geometry-dom.js'
import type { ChatLayout, Rect } from '../layout-tree.js'
import { clampWindow, resizeRect, tearOffRect, windowMinimum, type ResizeEdge, type WindowSize } from './window-layout.js'
import { sameTarget, targetPreview, windowTargetAt, type WindowTarget, type WindowTile } from './window-targets.js'

// Moving and resizing windows with the pointer. The window is painted straight onto its DOM box
// while the pointer moves (as the split divider does), so transcripts do not re-render per frame;
// the tree changes once, on release: float where dropped, snap into the tiled layout, join a
// window's tabs, or maximize. Escape puts the window back where it started.

export type WindowFrame = {
  tree: ChatLayout
  size: WindowSize
  browserVisible: boolean
  /** Tiled windows on screen. */
  tiled: WindowTile[]
  /** Floating windows on screen, front to back, at their clamped rects. */
  floating: WindowTile[]
}

export type WindowGesture = { id: string; kind: 'move' | ResizeEdge; target: WindowTarget; preview: Rect | null }

const START_DISTANCE = 5

export function useWindowDrag({ canvas, frame, onActive, onPainted, onFloat, onSnap, onGroup, onMaximize }: {
  canvas: RefObject<HTMLElement | null>
  frame: () => WindowFrame
  /** A gesture started: occlude the native browser and let the release glide. */
  onActive: () => void
  /** A box was painted outside React; the glide records it as laid out. */
  onPainted: (element: HTMLElement) => void
  /** `tornOff`: the window left the tiled layer, so the windows it leaves keep their places too. */
  onFloat: (id: string, rect: Rect, tornOff: boolean) => void
  onSnap: (id: string, target: WindowTarget & { kind: 'split' }) => void
  onGroup: (id: string, target: string) => void
  onMaximize: (id: string) => void
}) {
  const [gesture, setGesture] = useState<WindowGesture | null>(null)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])

  const paint = (id: string, rect: Rect): void => {
    const element = canvas.current ? layoutTileElement(canvas.current, id) : null
    if (!element) return
    element.style.left = `${rect.x}px`
    element.style.top = `${rect.y}px`
    element.style.width = `${rect.width}px`
    element.style.height = `${rect.height}px`
    onPainted(element)
  }

  const track = (event: ReactPointerEvent, id: string, kind: WindowGesture['kind'], start: Rect,
    update: (dx: number, dy: number, pointer: { x: number; y: number }) => void, release: () => void): void => {
    const host = canvas.current
    if (event.button !== 0 || stop.current || !host) return
    event.preventDefault()
    const { pointerId, clientX: x0, clientY: y0 } = event
    let started = false
    const local = (e: PointerEvent) => {
      const bounds = host.getBoundingClientRect()
      return { x: e.clientX - bounds.left, y: e.clientY - bounds.top }
    }
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', escape, true)
      delete document.body.dataset.windowGesture
      stop.current = null
      setGesture(null)
    }
    const move = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) return
      if (!started) {
        if (Math.hypot(e.clientX - x0, e.clientY - y0) < START_DISTANCE) return
        started = true
        document.body.dataset.windowGesture = kind
        onActive()
        setGesture({ id, kind, target: { kind: 'free' }, preview: null })
      }
      update(e.clientX - x0, e.clientY - y0, local(e))
    }
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) return
      finish()
      if (started) release()
    }
    const cancel = (): void => {
      finish()
      if (started) paint(id, start)
    }
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', escape, true)
    stop.current = finish
  }

  /** Drag a window by its header; a tiled window tears off at a floating size under the pointer. */
  const startMove = useCallback((event: ReactPointerEvent, id: string): void => {
    const first = frame()
    const floating = first.floating.find((tile) => tile.id === id)?.rect
    const tiled = first.tiled.find((tile) => tile.id === id)?.rect
    const start = floating ?? tiled
    if (!start) return
    const minimum = windowMinimum(id)
    let base: Rect | null = floating ?? null
    let rect = start
    let target: WindowTarget = { kind: 'free' }
    track(event, id, 'move', start, (dx, dy, pointer) => {
      const now = frame()
      if (!base) {
        const grab = { x: pointer.x - dx, y: pointer.y - dy }
        base = tearOffRect(start, now.size, grab, minimum)
      }
      rect = clampWindow({ ...base, x: base.x + dx, y: base.y + dy }, now.size, minimum)
      paint(id, rect)
      const next = windowTargetAt(id, pointer.x, pointer.y, now.size, now.tiled, now.floating)
      if (sameTarget(next, target)) return
      target = next
      const preview = targetPreview(now.tree, id, next, now.size, now.browserVisible, now.tiled, now.floating)
      setGesture({ id, kind: 'move', target: next, preview })
    }, () => {
      if (target.kind === 'split') onSnap(id, target)
      else if (target.kind === 'group') onGroup(id, target.target)
      else if (target.kind === 'maximize') {
        // Restoring puts the window back where it was before the drag: its float, or its slot.
        paint(id, start)
        onMaximize(id)
      } else onFloat(id, rect, !floating)
    })
  }, [frame, onFloat, onSnap, onGroup, onMaximize])

  /** Resize a floating window from one of its edges or corners. */
  const startResize = useCallback((event: ReactPointerEvent, id: string, edge: ResizeEdge): void => {
    event.stopPropagation()
    const start = frame().floating.find((tile) => tile.id === id)?.rect
    if (!start) return
    const minimum = windowMinimum(id)
    let rect = start
    track(event, id, edge, start, (dx, dy) => {
      rect = resizeRect(start, edge, dx, dy, minimum)
      paint(id, rect)
    }, () => onFloat(id, rect, false))
  }, [frame, onFloat])

  return { gesture, startMove, startResize }
}
