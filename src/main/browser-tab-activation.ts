import type { BrowserBounds } from '../shared/types.js'
import type { BrowserSurfaceVisibility } from './browser-surface-visibility.js'

export type ActivatableTabSurface = {
  id: string
  hide: () => void
  applyBounds: (bounds: BrowserBounds, show: boolean) => void
}

export type RenderableTabSurface = ActivatableTabSurface & {
  park: (bounds: BrowserBounds) => void
}

/** Order the native operations required to switch tabs without exposing a frameless view. */
export function activateTabSurface(
  tabs: readonly ActivatableTabSurface[],
  next: ActivatableTabSurface,
  bounds: BrowserBounds,
  visibility: BrowserSurfaceVisibility,
  commitActive: () => void,
  raiseActive: () => void
): void {
  // Show the incoming tab before hiding the outgoing one so the compositor never paints an
  // empty browser box for a frame (the same handoff ordering used for chat tab reveals).
  if (visibility.paneVisible) next.applyBounds(bounds, visibility.pageVisible)
  for (const tab of tabs) {
    if (tab.id !== next.id) tab.hide()
  }
  commitActive()
  if (visibility.paneVisible) raiseActive()
}

/** Give a tool-targeted tab an honest viewport before CDP geometry or capture reads it. */
export function prepareTabSurfaceForTool(
  tab: RenderableTabSurface,
  activeId: string | null,
  bounds: BrowserBounds,
  visibility: BrowserSurfaceVisibility
): void {
  if (!visibility.paneVisible) return
  if (tab.id === activeId) tab.applyBounds(bounds, visibility.pageVisible)
  else tab.park(bounds)
}
