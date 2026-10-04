import { canUseSidebarStackLayout, type CanvasSize } from './layout-presets.js'
import { layoutGeometry, type ChatLayout } from './layout-tree.js'
import { tabOwner } from './layout-tabs.js'

/** Match `@container chat-tile (max-height: …)` in `tile-background.css`. */
export const STACK_MONITOR_TILE_MAX_HEIGHT_PX = 400

export function paneTileHeight(tree: ChatLayout | null, size: CanvasSize, paneId: string): number | null {
  if (!tree || size.width <= 0 || size.height <= 0) return null
  const owner = tabOwner(tree, paneId) ?? paneId
  const match = layoutGeometry(tree, size.width, size.height).panes.find((pane) => pane.id === owner)
  return match?.rect.height ?? null
}

export function shouldPromoteStackMonitorSelection(
  tileHeight: number | null,
  deskChatCount: number,
  canvas: CanvasSize
): boolean {
  if (tileHeight === null || tileHeight > STACK_MONITOR_TILE_MAX_HEIGHT_PX) return false
  return canUseSidebarStackLayout(deskChatCount, canvas)
}

/** Same gate as {@link shouldPromoteStackMonitorSelection} using live layout geometry for `paneId`. */
export function canPromoteStackMonitorLead(
  tree: ChatLayout | null,
  size: CanvasSize,
  paneId: string,
  deskChatCount: number
): boolean {
  return shouldPromoteStackMonitorSelection(paneTileHeight(tree, size, paneId), deskChatCount, size)
}
