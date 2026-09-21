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
  const { rect } = tile
  const distances: Record<DockEdge, number> = {
    left: (x - rect.x) / rect.width, right: (rect.x + rect.width - x) / rect.width,
    top: (y - rect.y) / rect.height, bottom: (rect.y + rect.height - y) / rect.height
  }
  let edge = (Object.keys(distances) as DockEdge[]).reduce((best, candidate) => distances[candidate] < distances[best] ? candidate : best)
  // A small dead band stops tiny pointer movements flipping the destination at diagonals.
  if (previous?.target === tile.id && distances[previous.edge] <= distances[edge] + 0.045) edge = previous.edge
  return { target: tile.id, edge }
}

export function browserDropPreview(tree: ChatLayout, drop: BrowserDrop, width: number, height: number) {
  return layoutGeometry(dockBrowser(tree, drop.target, drop.edge, 'browser-drop-preview'), width, height)
}

export function sameBrowserDrop(a: BrowserDrop | null, b: BrowserDrop | null): boolean {
  return a?.target === b?.target && a?.edge === b?.edge
}
