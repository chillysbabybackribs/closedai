import { useEffect, type RefObject } from 'react'

/** Tell main where the layout canvas is so cross-window drags map to the right drop zones. */
export function useReportDockSurface(canvas: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const host = canvas.current
    if (!host) return
    const report = (): void => {
      const box = host.getBoundingClientRect()
      void window.closedai.windows.reportDockSurface({
        x: box.left, y: box.top, width: box.width, height: box.height
      })
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(host)
    window.addEventListener('scroll', report, true)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', report, true)
      window.removeEventListener('resize', report)
      void window.closedai.windows.reportDockSurface(null)
    }
  }, [canvas])
}
