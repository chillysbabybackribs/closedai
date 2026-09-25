import type { JSX } from 'react'
import { RailSurface } from './rail-surface.js'
import type { TabShape } from './tab-outline.js'

/** The title bar's strip under a backdrop; the tab round chat search drops to the bar's full 44px. */
export const TITLEBAR_STRIP = 32
export const TITLEBAR_TAB: TabShape = { strip: TITLEBAR_STRIP, radius: 7, fillet: 5, opens: 'down' }

/**
 * The title bar's glass: a thin strip for the menus and window controls with a tab dropping out of
 * it round chat search, the dock's shape mirrored onto the top edge. Painted only while a
 * backdrop is on (glass.css); without one the title bar stays flat.
 */
export function TitlebarRail({ search }: { search: HTMLElement | null }): JSX.Element {
  return <RailSurface target={search} shape={TITLEBAR_TAB} fillSlot="titlebar-rail-fill"
    className="titlebar-rail" lineClassName="titlebar-rail-line" />
}
