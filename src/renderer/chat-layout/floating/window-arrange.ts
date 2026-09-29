import { layoutGroups } from '../layout-docking.js'
import { BROWSER_PANE_ID, DIVIDER_SIZE, WORKSPACE_DOCK_ID, isViewTabId, type ChatLayout, type Rect } from '../layout-tree.js'
import { moveTab, tabIds, tabOwner } from '../layout-tabs.js'
import { WINDOW_HEADER, findWindow, floatWindow, mapWindow, snapWindow, windowMinimum, windowPanes, withoutFloat, type WindowSize } from './window-layout.js'
import type { WindowTile } from './window-targets.js'

// Arranging windows as a desktop does: moving one window never resizes another. A window torn out
// of the tiled layout leaves the others floating exactly where they were, and every window keeps
// its slot in the tree while it floats, so Tile windows puts the last tiled layout back as it was.

/** How near a workspace side a window's edge counts as touching it. */
const FLUSH = 4

/** Whether any window on screen floats: what Tile windows would put back. */
export function hasFloatingWindows(tree: ChatLayout): boolean {
  return windowPanes(tree).some((pane) => pane.float && !pane.docked)
}

/**
 * Float `id` at `rect`, in front, and every other window of the tiled layer at the rect it has on
 * screen (`tiled`), behind the windows already floating.
 */
export function tearOffWindow(tree: ChatLayout, id: string, rect: Rect, tiled: readonly WindowTile[]): ChatLayout {
  let next = tree
  for (const tile of tiled) {
    if (tile.id === id || findWindow(next, tile.id)?.float) continue
    const { x, y, width, height } = tile.rect
    next = mapWindow(next, tile.id, (pane) => ({ ...pane, float: { x, y, width, height, z: 0 } }))
  }
  return floatWindow(next, id, rect)
}

/** Chat windows a workspace holds at once, as the layout controller enforces for splits. */
const MAX_CHAT_WINDOWS = 32

/**
 * A tab dropped on free space becomes its own floating window at `rect`, in front. Its slot in the
 * tree sits beside the window it left, so Tile windows gives it a place; the tiled layout does not
 * change. A window's only tab moves the whole window, as dragging its title bar would.
 */
export function tearOffTab(tree: ChatLayout, id: string, rect: Rect, tiled: readonly WindowTile[], splitId: string): ChatLayout {
  const owner = tabOwner(tree, id)
  if (!owner || owner === BROWSER_PANE_ID) return tree
  const alone = tabIds(tree).every((tab) => tab === id || tabOwner(tree, tab) !== owner)
  if (alone) return findWindow(tree, owner)?.float ? floatWindow(tree, owner, rect) : tearOffWindow(tree, owner, rect, tiled)
  if (!isViewTabId(id) && layoutGroups(tree).filter((group) => !isViewTabId(group.id)).length >= MAX_CHAT_WINDOWS) return tree
  const split = moveTab(tree, id, owner, 'right', splitId)
  return split === tree ? tree : floatWindow(split, id, rect)
}

/**
 * Where a torn-off tab's window opens: the size of the window it left (a tiled one's comfortable
 * share of the canvas), with the new window's tab under the pointer.
 */
export function tabTearOffRect(source: Rect, floating: boolean, canvas: WindowSize, pointer: { x: number; y: number }, id: string): Rect {
  const minimum = windowMinimum(id)
  const width = Math.max(minimum.width, floating ? source.width : Math.min(source.width, canvas.width * 0.45))
  const height = Math.max(minimum.height, floating ? source.height : Math.min(source.height, canvas.height * 0.75))
  return { x: Math.round(pointer.x - Math.min(96, width / 4)), y: Math.round(pointer.y - WINDOW_HEADER / 2),
    width: Math.round(width), height: Math.round(height) }
}

/** Every window back into its slot of the tiled layout, minimized ones included for when they return. */
export function tileWindows(tree: ChatLayout): ChatLayout {
  return windowPanes(tree).reduce((next, pane) => pane.float ? mapWindow(next, pane.id, withoutFloat) : next, tree)
}

/** One window back into its slot; the others stay where they are. */
export function tileWindow(tree: ChatLayout, id: string): ChatLayout {
  return mapWindow(tree, tabOwner(tree, id) ?? id, withoutFloat)
}

function fillsSide(rect: Rect, side: 'left' | 'right', canvas: WindowSize): boolean {
  const flush = side === 'left' ? rect.x <= FLUSH : rect.x + rect.width >= canvas.width - FLUSH
  return flush && rect.y <= FLUSH && rect.y + rect.height >= canvas.height - FLUSH
}

/** The half of the workspace on `edge`, sized so two halves meet at a divider. */
export function halfRect(edge: 'left' | 'right', canvas: WindowSize): Rect {
  const width = Math.round((canvas.width - DIVIDER_SIZE) / 2)
  return { x: edge === 'left' ? 0 : canvas.width - width, y: 0, width, height: canvas.height }
}

/**
 * Snap `id` to the workspace's left or right side. Beside other tiled windows it becomes a
 * full-height column. With nothing else tiled it takes that half of the workspace; and when a
 * floating window already fills the other side, the two become a tiled pair sharing a divider, at
 * that window's width. `tiled` and `floating` are the windows on screen.
 */
export function snapToSide(tree: ChatLayout, id: string, edge: 'left' | 'right', canvas: WindowSize,
  tiled: readonly WindowTile[], floating: readonly WindowTile[], splitId: string): ChatLayout {
  if (tiled.some((tile) => tile.id !== id)) return snapWindow(tree, id, WORKSPACE_DOCK_ID, edge, splitId)
  const room = canvas.width - windowMinimum(id).width - DIVIDER_SIZE
  const partner = floating.find((tile) => tile.id !== id && tile.rect.width <= room
    && fillsSide(tile.rect, edge === 'left' ? 'right' : 'left', canvas))
  if (!partner) return floatWindow(tree, id, halfRect(edge, canvas))
  const paired = snapWindow(mapWindow(tree, partner.id, withoutFloat), id, WORKSPACE_DOCK_ID, edge, splitId)
  if (paired.kind !== 'split' || paired.id !== splitId) return paired
  const available = canvas.width - DIVIDER_SIZE
  const share = Math.min(partner.rect.width, available) / available
  return { ...paired, ratio: Math.min(0.95, Math.max(0.05, edge === 'left' ? 1 - share : share)) }
}

/** Keep a window above every window without it; the browser's page cannot stay under one, so it never is. */
export function setWindowOnTop(tree: ChatLayout, id: string, onTop: boolean): ChatLayout {
  const owner = tabOwner(tree, id)
  if (!owner || owner === BROWSER_PANE_ID) return tree
  return mapWindow(tree, owner, (pane) => {
    if (Boolean(pane.onTop) === onTop) return pane
    if (onTop) return { ...pane, onTop: true }
    const { onTop: _onTop, ...rest } = pane
    return rest
  })
}
