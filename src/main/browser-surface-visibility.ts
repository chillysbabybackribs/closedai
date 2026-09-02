import type { BrowserBounds } from '../shared/types.js'

export type BrowserSurfaceVisibility = {
  paneVisible: boolean
  pageVisible: boolean
}

/** Distinguish a removed workspace pane from a live page temporarily covered by app chrome. */
export function browserSurfaceVisibility(bounds: BrowserBounds): BrowserSurfaceVisibility {
  const paneVisible = bounds.visible !== false
  return {
    paneVisible,
    pageVisible: paneVisible && bounds.occluded !== true
  }
}
