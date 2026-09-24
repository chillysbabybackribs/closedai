import type { BrowserBounds } from '../shared/types.js'

export type BrowserSurfaceVisibility = {
  paneVisible: boolean
  pageVisible: boolean
}

export type RefreshableBrowserSurface = {
  setBounds(bounds: BrowserBounds): void
  setVisible(visible: boolean): void
}

/** Collapsed layout reports must not replace a loaded page's viewport with a zero-size box. */
export function browserPaneBounds(previous: BrowserBounds, next: BrowserBounds): BrowserBounds {
  if (next.visible !== false && next.width > 1 && next.height > 1) return next
  return { ...previous, visible: false, occluded: next.occluded }
}

/** Distinguish a removed workspace pane from a live page temporarily covered by app chrome. */
export function browserSurfaceVisibility(bounds: BrowserBounds): BrowserSurfaceVisibility {
  const paneVisible = bounds.visible !== false
  return {
    paneVisible,
    pageVisible: paneVisible && bounds.occluded !== true
  }
}

/**
 * Keep a covered WebContentsView live without letting it paint through the renderer overlay.
 *
 * Toggling setVisible(false/true) on a loaded view can return a permanently blank Electron
 * surface, and a view moved entirely outside the window is unmapped by Chromium's native view
 * host: it stops relayouting to new bounds and a capture returns its old frame at the old size.
 * A view whose corner pixel is still inside the window stays mapped and keeps laying out and
 * painting at its real size, which is what a drag preview capture needs; the rounded page
 * corner masks that one pixel. Reparenting the page into a hidden window instead leaves its
 * drawing widget hidden on return, which is how a tab came back blank until the next tab switch.
 */
export function browserOccludedBounds(bounds: BrowserBounds): BrowserBounds {
  const width = Math.max(1, Math.round(bounds.width))
  const height = Math.max(1, Math.round(bounds.height))
  return { x: 1 - width, y: 1 - height, width, height }
}

/** Reassert a loaded on-screen view after Chromium replaces its navigation frame sink. */
export function refreshVisibleBrowserSurface(
  surface: RefreshableBrowserSurface,
  bounds: BrowserBounds,
  visible: boolean
): boolean {
  if (!visible || bounds.width <= 1 || bounds.height <= 1) return false
  surface.setBounds(bounds)
  surface.setVisible(true)
  return true
}
