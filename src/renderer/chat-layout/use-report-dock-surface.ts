import { useEffect, type RefObject } from 'react'

/**
 * Tell main where the layout canvas is so cross-window drags map to the right drop zones.
 *
 * Scroll is captured window-wide, so transcript auto-scroll during a streamed turn fires this
 * many times a second. Reads and the IPC are coalesced to one animation frame, and a rect that
 * did not move is not re-sent: main only needs to hear about changes.
 */
export function useReportDockSurface(canvas: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const host = canvas.current
    if (!host) return
    let frame = 0
    let last: { x: number; y: number; width: number; height: number } | null = null
    const report = (): void => {
      frame = 0
      const box = host.getBoundingClientRect()
      const next = { x: box.left, y: box.top, width: box.width, height: box.height }
      if (last && last.x === next.x && last.y === next.y && last.width === next.width && last.height === next.height) return
      last = next
      void window.closedai.windows.reportDockSurface(next)
    }
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(report)
    }
    report()
    const observer = new ResizeObserver(schedule)
    observer.observe(host)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      void window.closedai.windows.reportDockSurface(null)
    }
  }, [canvas])
}
