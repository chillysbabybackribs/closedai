import type { JSX } from 'react'
import { RailSurface } from '../rail/rail-surface.js'
import { DOCK_HEIGHT, DOCK_TAB, TAB_RISE } from './dock-model.js'

/**
 * The dock's surface: the strip and the tab over the tray as one raised shape, a step above the
 * workspace it covers. The tab follows the tray's measured box, which widens as icons grow.
 */
export function DockSurface({ tray }: { tray: HTMLElement | null }): JSX.Element {
  return <RailSurface target={tray} shape={DOCK_TAB} fillSlot="dock-surface-fill"
    className="pointer-events-none absolute inset-x-0 bottom-0 -z-10" style={{ height: DOCK_HEIGHT + TAB_RISE }}
    fillClassName="bg-popover/85 backdrop-blur-md" lineClassName="stroke-[var(--hairline-strong)]" />
}
