import { useLayoutEffect, useRef, useState, type JSX } from 'react'
import { DOCK_HEIGHT, TAB_RISE, dockOutlinePath, type DockOutline } from './dock-model.js'

/**
 * The dock's surface: the strip and the tab over the tray drawn as one shape, so the tab reads as
 * part of the bar rather than a panel on it. It is raised material, a step above the workspace it
 * covers. The fill (blur included) is clipped to the outline and one 1px line traces its top. The
 * tab follows the tray's measured box, which widens as icons grow.
 */
export function DockSurface({ tray }: { tray: HTMLElement | null }): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<DockOutline | null>(null)
  useLayoutEffect(() => {
    const surface = root.current
    const target = tray
    if (!surface || !target) return
    const measure = (): void => {
      const outer = surface.getBoundingClientRect()
      const inner = target.getBoundingClientRect()
      const next = { width: outer.width, height: outer.height, tabLeft: inner.left - outer.left, tabWidth: inner.width }
      setBox((last) => last && last.width === next.width && last.height === next.height
        && last.tabLeft === next.tabLeft && last.tabWidth === next.tabWidth ? last : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(surface)
    observer.observe(target)
    return () => observer.disconnect()
  }, [tray])

  return <div ref={root} aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 -z-10" style={{ height: DOCK_HEIGHT + TAB_RISE }}>
    {box && <>
      <div className="absolute inset-0 bg-popover/85 backdrop-blur-md" style={{ clipPath: `path('${dockOutlinePath(box, 0, true)}')` }} />
      <svg className="absolute inset-0 size-full overflow-visible">
        <path d={dockOutlinePath(box, 0.5)} fill="none" strokeWidth={1} className="stroke-[var(--hairline-strong)]" />
      </svg>
    </>}
  </div>
}
