import { BROWSER_PANE_ID, dockPane, layoutGeometry, paneIds, type ChatLayout, type DockEdge } from './layout-tree.js'
import { moveTab, removeTab, tabOwner } from './layout-tabs.js'
import { browserDropPreview } from './browser-drop.js'

export type DragDropTarget = { target: string; edge: DockEdge | null }

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
  const previewTree = singleTab
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
  return layoutGeometry(previewTree, width, height)
}
