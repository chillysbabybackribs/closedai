import { useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { tabOutlinePath, type TabOutlineBox, type TabShape } from './tab-outline.js'

export type RailSurfaceProps = {
  /** What the tab holds; the tab follows its measured box as it moves or widens. */
  target: HTMLElement | null
  shape: TabShape
  /** Places the surface; it spans the rail and the tab's reach. */
  className: string
  style?: CSSProperties
  fillSlot: string
  fillClassName?: string
  lineClassName?: string
}

/**
 * A rail's surface: the strip and the tab around `target` drawn as one shape, so the tab reads as
 * part of the bar rather than a panel on it. The fill is clipped to the outline and one 1px line
 * traces its inner edge, the side facing the workspace.
 */
export function RailSurface({ target, shape, className, style, fillSlot, fillClassName, lineClassName }: RailSurfaceProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<TabOutlineBox | null>(null)
  useLayoutEffect(() => {
    const surface = root.current
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
  }, [target])

  return <div ref={root} aria-hidden="true" className={className} style={style}>
    {box && <>
      <div data-slot={fillSlot} className={fillClassName} style={{ position: 'absolute', inset: 0, clipPath: `path('${tabOutlinePath(box, shape, 0, true)}')` }} />
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
        <path d={tabOutlinePath(box, shape, 0.5)} fill="none" strokeWidth={1} className={lineClassName} />
      </svg>
    </>}
  </div>
}
