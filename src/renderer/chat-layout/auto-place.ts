import { appendSideChat } from './sidebar-stack.js'
import { BROWSER_PANE_ID, DIVIDER_SIZE, dockPane, layoutGeometry, minimumSize, removePane, type ChatLayout, type DockEdge, type Rect } from './layout-tree.js'
import { tiledTree } from './layout-docking.js'
import { windowMinimum } from './floating/window-layout.js'

// Where a window opened from the dock (a new chat, the notepad) goes: into the tiled layout the
// user already has, by halving the roomiest tile, so every open-from-dock keeps the arrangement
// even and readable. Two full-height chats beside the browser become top and bottom halves one at
// a time; once every tile is a half, the next one splits a half side by side, and so on until no
// tile can be halved above its minimum size. The browser is never split. The result is an
// ordinary tree, so drags, resizes and presets treat the new tile like any other.

export type AutoPlaceCanvas = { width: number; height: number; browserVisible: boolean }
/** Builds the tree with a new window; `tile` places `id` into the tiled layout, or returns null. */
export type WindowOpen = (tree: ChatLayout, tile: (tree: ChatLayout, id: string) => ChatLayout | null) => ChatLayout
export type Placement = { target: string; edge: DockEdge; rect: Rect }

/** Tiles whose areas differ by less than this count as the same size. */
const SAME_SIZE = 0.04

const half = (rect: Rect, edge: DockEdge): Rect => edge === 'bottom'
  ? { ...rect, height: (rect.height - DIVIDER_SIZE) / 2 }
  : { ...rect, width: (rect.width - DIVIDER_SIZE) / 2 }

/**
 * The tile to halve and on which edge the new window goes (bottom for a top/bottom split, right for
 * side by side), or null when no tile can be halved without breaking a minimum size. Among tiles of
 * about the same size the preferred one (the selected chat's) wins, then tree order.
 */
export function autoPlacement(tree: ChatLayout | null, added: string, canvas: AutoPlaceCanvas, prefer?: string | null): Placement | null {
  if (!tree || !(canvas.width > 0) || !(canvas.height > 0)) return null
  const visible = canvas.browserVisible ? tree : removePane(tree, BROWSER_PANE_ID)
  const tiled = visible ? tiledTree(visible) : null
  if (!tiled) return null
  const floor = minimumSize(tiled)
  if (floor.width > canvas.width || floor.height > canvas.height) return null
  const minimum = windowMinimum(added)
  const options: Array<Placement & { area: number; order: number }> = []
  layoutGeometry(tiled, canvas.width, canvas.height).panes.forEach((pane, order) => {
    if (pane.id === BROWSER_PANE_ID) return
    // Halve along the longer side first, so tiles stay close to square.
    const edges: DockEdge[] = pane.rect.height >= pane.rect.width ? ['bottom', 'right'] : ['right', 'bottom']
    for (const edge of edges) {
      const rect = half(pane.rect, edge)
      if (rect.width < minimum.width || rect.height < minimum.height) continue
      const next = tiledTree(dockPane(tiled, added, pane.id, edge, 'closedai:auto-place-probe'))
      const needed = next ? minimumSize(next) : floor
      if (needed.width > canvas.width || needed.height > canvas.height) continue
      options.push({ target: pane.id, edge, rect, area: pane.rect.width * pane.rect.height, order })
      break
    }
  })
  if (!options.length) return null
  const largest = Math.max(...options.map((option) => option.area))
  const roomiest = options.filter((option) => option.area >= largest * (1 - SAME_SIZE))
  const best = roomiest.find((option) => option.target === prefer) ?? roomiest.sort((a, b) => a.order - b.order)[0]!
  return { target: best.target, edge: best.edge, rect: best.rect }
}

/** `added` tiled into the best slot (see autoPlacement), or null when it should float instead. */
export function autoPlace(tree: ChatLayout | null, added: string, canvas: AutoPlaceCanvas, splitId: string, prefer?: string | null): ChatLayout | null {
  const side = tree && appendSideChat(tree, added, () => crypto.randomUUID())
  if (side) return side
  const placement = autoPlacement(tree, added, canvas, prefer)
  return placement && tree ? dockPane(tree, added, placement.target, placement.edge, splitId) : null
}
