import { BROWSER_PANE_ID, dockPane, layoutGeometry, paneIds, type ChatLayout, type DockEdge, type Rect } from './layout-tree.js'
import { moveTab, removeTab, tabOwner } from './layout-tabs.js'
import { browserDropPreview } from './browser-drop.js'

export type DragDropTarget = { target: string; edge: DockEdge | null }

/** Layout after a split drop; null when the drop would not change splits. */
export function dragPreviewTree(
  tree: ChatLayout,
  sourceId: string,
  drop: DragDropTarget,
  singleTab: boolean
): ChatLayout | null {
  if (!drop.edge) return null
  if (sourceId === BROWSER_PANE_ID) {
    return null
  }
  return singleTab
    ? moveTab(tree, sourceId, drop.target, drop.edge, 'drag-preview')
    : dockPane(
        tabOwner(tree, sourceId) && !paneIds(tree).includes(sourceId)
          ? removeTab(tree, sourceId)!
          : tree,
        sourceId,
        drop.target,
        drop.edge,
        'drag-preview'
      )
}

/** Live split geometry while a pane or browser is dragged; null when the drop would not change splits. */
export function dragSplitPreview(
  tree: ChatLayout,
  sourceId: string,
  drop: DragDropTarget,
  singleTab: boolean,
  width: number,
  height: number
): ReturnType<typeof layoutGeometry> | null {
  if (!drop.edge) return null
  if (sourceId === BROWSER_PANE_ID) {
    return browserDropPreview(tree, { target: drop.target, edge: drop.edge }, width, height)
  }
  const previewTree = dragPreviewTree(tree, sourceId, drop, singleTab)
  return previewTree ? layoutGeometry(previewTree, width, height) : null
}

/** Chat drop targets stay anchored to the layout before preview resizing. */
export function chatDropAt(
  panes: Array<{ id: string; rect: Rect }>, x: number, y: number,
  previous: DragDropTarget | null = null
): DragDropTarget | null {
  const tile = panes.find(({ rect }) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height)
  if (!tile) return null
  const dx = (x - tile.rect.x) / tile.rect.width
  const dy = (y - tile.rect.y) / tile.rect.height
  const held = previous?.target === tile.id ? previous : null
  if (tile.id === BROWSER_PANE_ID) {
    const margin = Math.min(0.1, 32 / tile.rect.width)
    if (held?.edge === 'left' && dx <= 0.5 + margin) return held
    if (held?.edge === 'right' && dx >= 0.5 - margin) return held
    return { target: tile.id, edge: dx < 0.5 ? 'left' : 'right' }
  }
  // Enter the tab strip deliberately; once there, allow a little downward drift.
  const stripBoundary = held ? (held.edge === null ? 50 : 26) : 38
  if (y - tile.rect.y < stripBoundary) return { target: tile.id, edge: null }
  const distances: Record<DockEdge, number> = { left: dx, right: 1 - dx, top: dy, bottom: 1 - dy }
  const edge = (Object.keys(distances) as DockEdge[]).reduce((best, candidate) => distances[candidate] < distances[best] ? candidate : best)
  // Measure penetration into the new zone in pixels, including diagonal boundaries.
  // This holds through small hand movements without delaying deliberate movement.
  if (held?.edge && held.edge !== edge) {
    const horizontal = (side: DockEdge): boolean => side === 'left' || side === 'right'
    const sameAxis = horizontal(held.edge) === horizontal(edge)
    const gradient = sameAxis
      ? 2 / (horizontal(edge) ? tile.rect.width : tile.rect.height)
      : Math.hypot(1 / tile.rect.width, 1 / tile.rect.height)
    const margin = Math.min(32, Math.min(tile.rect.width, tile.rect.height) * 0.1)
    if (distances[held.edge] - distances[edge] <= margin * gradient) return held
  }
  return { target: tile.id, edge }
}

/** Keep existing DOM shells in place, adding any shell created by splitting a tab. */
export function dragPreviewPanes(
  committed: ReturnType<typeof layoutGeometry>['panes'],
  preview: ReturnType<typeof layoutGeometry> | null
): ReturnType<typeof layoutGeometry>['panes'] {
  if (!preview) return committed
  return [...committed.map((pane) => preview.panes.find((next) => next.id === pane.id) ?? pane),
    ...preview.panes.filter((pane) => !committed.some((previous) => previous.id === pane.id))]
}
