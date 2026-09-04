import type { BrowserBounds } from '../shared/types.js'

export type BrowserSurfaceVisibility = {
  paneVisible: boolean
  pageVisible: boolean
}

const OCCLUDED_SURFACE_GUTTER = 64

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
