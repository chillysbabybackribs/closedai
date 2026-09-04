import type { BrowserBounds } from '../shared/types.js'

export type BrowserSurfaceVisibility = {
  paneVisible: boolean
  pageVisible: boolean
}

export type RefreshableBrowserSurface = {
  setBounds(bounds: BrowserBounds): void
  setVisible(visible: boolean): void
}

const OCCLUDED_SURFACE_GUTTER = 64

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
 * Keep an overlay-covered WebContentsView compositing without letting it paint through the
 * renderer overlay. Toggling setVisible(false/true) on a loaded view can return a permanently
 * blank Electron surface, so move the unchanged viewport just beyond its browser box instead.
 */
export function browserOccludedBounds(bounds: BrowserBounds): BrowserBounds {
  const x = Math.max(0, Math.round(bounds.x))
  const y = Math.max(0, Math.round(bounds.y))
  const width = Math.max(1, Math.round(bounds.width))
  const height = Math.max(1, Math.round(bounds.height))
  return { x: x + width + OCCLUDED_SURFACE_GUTTER, y, width, height }
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
