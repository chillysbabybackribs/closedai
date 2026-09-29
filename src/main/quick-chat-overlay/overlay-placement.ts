import type { BrowserBounds } from '../../shared/types.js'
import type { QuickChatOverlaySize } from '../../shared/quick-chat-overlay.js'

export type OverlayRect = { x: number; y: number; width: number; height: number }

/**
 * Where the quick chat layer sits: centred on the page and resting on its foot, never larger than
 * the page. The card draws its own margin, so the layer's edge is the page's edge.
 *
 * A hidden layer is parked with one pixel inside the window's corner, the same way a covered page
 * is (browserOccludedBounds): a view moved wholly outside the window stops laying out, and toggling
 * visibility can leave a loaded view blank. The layer is transparent, so that pixel shows nothing.
 */
export function quickChatOverlayBounds(page: BrowserBounds, size: QuickChatOverlaySize | null, shown: boolean): OverlayRect {
  const width = Math.max(1, Math.round(size?.width ?? 1))
  const height = Math.max(1, Math.round(size?.height ?? 1))
  if (!shown || !size || page.width <= 1 || page.height <= 1) return { x: 1 - width, y: 1 - height, width, height }
  const fitWidth = Math.min(width, Math.round(page.width))
  const fitHeight = Math.min(height, Math.round(page.height))
  return {
    x: Math.round(page.x + (page.width - fitWidth) / 2),
    y: Math.round(page.y + page.height - fitHeight),
    width: fitWidth,
    height: fitHeight
  }
}

/** A size the layer reported, or null when it is not a usable box. */
export function overlaySize(raw: unknown): QuickChatOverlaySize | null {
  if (!raw || typeof raw !== 'object') return null
  const { width, height } = raw as Record<string, unknown>
  if (typeof width !== 'number' || typeof height !== 'number') return null
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null
  return { width: Math.min(width, 10_000), height: Math.min(height, 10_000) }
}
