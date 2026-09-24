import { BROWSER_PANE_ID, dockPane, layoutGeometry, paneIds, removePane, type ChatLayout, type DockEdge, type Rect } from './layout-tree.js'
import { moveTab, removeTab, tabOwner } from './layout-tabs.js'
import { browserDropPreview, splitDropEdge } from './browser-drop.js'

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
  height: number,
  browserVisible = true
): ReturnType<typeof layoutGeometry> | null {
  if (!drop.edge) return null
  if (sourceId === BROWSER_PANE_ID) {
    return browserDropPreview(tree, { target: drop.target, edge: drop.edge }, width, height)
  }
  const previewTree = dragPreviewTree(tree, sourceId, drop, singleTab)
  // Apply the move to the saved tree before projecting visibility, just as commit does.
  // A hidden browser retains its dock position without taking up preview space.
  const visiblePreview = previewTree && !browserVisible ? removePane(previewTree, BROWSER_PANE_ID) : previewTree
  return visiblePreview ? layoutGeometry(visiblePreview, width, height) : null
}

/** Chat drop targets stay anchored to the layout before preview resizing. */
export function chatDropAt(
  panes: Array<{ id: string; rect: Rect }>, x: number, y: number,
  previous: DragDropTarget | null = null
): DragDropTarget | null {
  const tile = panes.find(({ rect }) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height)
  if (!tile) return null
  const dx = (x - tile.rect.x) / tile.rect.width
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
  return { target: tile.id, edge: splitDropEdge(tile.rect, x, y, held?.edge ?? null) }
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
