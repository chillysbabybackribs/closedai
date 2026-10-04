import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'

const DRAG_THRESHOLD_PX = 4

/** Pointer drag for the shell title-bar gap (no-drag so double-click works; move window by delta). */
export function useTitlebarFitPointer(): {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
} {
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)

  const reset = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    anchor.current = null
    dragging.current = false
  }, [])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    anchor.current = { x: event.screenX, y: event.screenY }
    dragging.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!anchor.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const dx = event.screenX - anchor.current.x
    const dy = event.screenY - anchor.current.y
    if (!dragging.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    dragging.current = true
    anchor.current = { x: event.screenX, y: event.screenY }
    void window.closedai.window.moveBy({ dx, dy })
  }, [])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    reset(event)
  }, [reset])

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    reset(event)
  }, [reset])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}
