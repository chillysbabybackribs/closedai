import { BROWSER_PANE_ID, WORKSPACE_DOCK_ID, dockBrowser, layoutGeometry, type ChatLayout, type DockEdge, type Rect } from './layout-tree.js'

export type BrowserDrop = { target: string; edge: DockEdge }
type Tile = { id: string; rect: Rect }

/** Resolve against the unchanged layout so the preview cannot move its own hit targets. */
export function browserDropAt(panes: Tile[], width: number, height: number, x: number, y: number, previous: BrowserDrop | null): BrowserDrop | null {
  if (x < 0 || y < 0 || x > width || y > height) return null
  // Keep the tab strip and original drag handle exposed throughout dragstart.
  if (y >= 38 && (x < 32 || x > width - 32)) {
    return { target: WORKSPACE_DOCK_ID, edge: x < 32 ? 'left' : 'right' }
  }
  const tile = panes.find(({ rect }) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height)
  if (!tile || tile.id === BROWSER_PANE_ID) return null
  return { target: tile.id, edge: splitDropEdge(tile.rect, x, y, previous?.target === tile.id ? previous.edge : null) }
}

export function browserDropPreview(tree: ChatLayout, drop: BrowserDrop, width: number, height: number) {
  return layoutGeometry(dockBrowser(tree, drop.target, drop.edge, 'browser-drop-preview'), width, height)
}

export function sameBrowserDrop(a: BrowserDrop | null, b: BrowserDrop | null): boolean {
  return a?.target === b?.target && a?.edge === b?.edge
}

/** Shared pixel-based hysteresis for browser and chat split previews. */
export function splitDropEdge(rect: Rect, x: number, y: number, previous: DockEdge | null): DockEdge {
  const dx = (x - rect.x) / rect.width
  const dy = (y - rect.y) / rect.height
  const distances: Record<DockEdge, number> = { left: dx, right: 1 - dx, top: dy, bottom: 1 - dy }
  const edge = (Object.keys(distances) as DockEdge[]).reduce((best, candidate) => distances[candidate] < distances[best] ? candidate : best)
  // Measure penetration into the new zone in pixels, including diagonal boundaries.
  // This holds through small hand movements without delaying deliberate movement.
  if (previous && previous !== edge) {
    const horizontal = (side: DockEdge): boolean => side === 'left' || side === 'right'
    const sameAxis = horizontal(previous) === horizontal(edge)
    const gradient = sameAxis
      ? 2 / (horizontal(edge) ? rect.width : rect.height)
      : Math.hypot(1 / rect.width, 1 / rect.height)
    const margin = Math.min(32, Math.min(rect.width, rect.height) * 0.1)
    if (distances[previous] - distances[edge] <= margin * gradient) return previous
  }
  return edge
}
