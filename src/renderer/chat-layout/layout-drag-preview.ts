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
export function chatDropAt(panes: Array<{ id: string; rect: Rect }>, x: number, y: number): DragDropTarget | null {
  const tile = panes.find(({ rect }) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height)
  if (!tile) return null
  const dx = (x - tile.rect.x) / tile.rect.width
  const dy = (y - tile.rect.y) / tile.rect.height
  if (tile.id === BROWSER_PANE_ID) return { target: tile.id, edge: dx < 0.5 ? 'left' : 'right' }
  if (y - tile.rect.y < 38) return { target: tile.id, edge: null }
  const edges: Array<[DockEdge, number]> = [['left', dx], ['right', 1 - dx], ['top', dy], ['bottom', 1 - dy]]
  return { target: tile.id, edge: edges.sort((a, b) => a[1] - b[1])[0]![0] }
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
