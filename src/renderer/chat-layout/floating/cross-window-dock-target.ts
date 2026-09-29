import type { SerializedWindowTarget } from '../../../shared/cross-window-dock.js'
import { BROWSER_PANE_ID, layoutGeometry, type ChatLayout, type DockEdge, type Rect } from '../layout-tree.js'
import { absorbCrossWindowDock } from './cross-window-absorb.js'
import { canvasTiles, floatingFront } from './window-tiles.js'
import { WINDOW_HEADER } from './window-layout.js'
import { windowTargetAt, type WindowTarget, type WindowTile } from './window-targets.js'

const inside = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height

const distanceToRect = (rect: Rect, x: number, y: number): number => {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width))
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height))
  return Math.hypot(dx, dy)
}

/** Chat tiles that can absorb another window, front to back like `windowTargetAt`. */
const dockableTiles = (sourcePaneId: string, tiled: readonly WindowTile[], floating: readonly WindowTile[]): WindowTile[] =>
  [...floating, ...tiled].filter((tile) => tile.id !== sourcePaneId && tile.id !== BROWSER_PANE_ID)

/** Cross-window body over a chat tile: join on the strip, stack top/bottom in the body. */
function crossDockBodyTarget(tile: WindowTile, pointer: { x: number; y: number }): WindowTarget {
  const { rect } = tile
  if (pointer.y - rect.y < WINDOW_HEADER) return { kind: 'group', target: tile.id }
  const mid = rect.y + rect.height / 2
  return { kind: 'split', target: tile.id, edge: pointer.y < mid ? 'top' : 'bottom' }
}

function nearestDockableTile(tiles: readonly WindowTile[], pointer: { x: number; y: number }): WindowTile | null {
  let best: { tile: WindowTile; distance: number } | null = null
  for (const tile of tiles) {
    const distance = distanceToRect(tile.rect, pointer.x, pointer.y)
    if (!best || distance < best.distance) best = { tile, distance }
  }
  return best?.tile ?? null
}

function crossDockGapTarget(tile: WindowTile, pointer: { x: number; y: number }): WindowTarget {
  const { rect } = tile
  const midX = rect.x + rect.width / 2
  const midY = rect.y + rect.height / 2
  const dx = pointer.x - midX
  const dy = pointer.y - midY
  const edge: DockEdge = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom')
  return { kind: 'split', target: tile.id, edge }
}

export function serializeWindowTarget(target: WindowTarget): SerializedWindowTarget {
  if (target.kind === 'split') return { kind: 'split', target: target.target, edge: target.edge }
  if (target.kind === 'group') return { kind: 'group', target: target.target }
  if (target.kind === 'maximize') return { kind: 'maximize' }
  return { kind: 'free' }
}

/** Cross-window drops stack in the body; same-window drags still float in the middle. */
export function resolveCrossDockTarget(sourcePaneId: string, pointer: { x: number; y: number }, canvas: { width: number; height: number },
  tiled: readonly WindowTile[], floating: readonly WindowTile[]): WindowTarget {
  const target = windowTargetAt(sourcePaneId, pointer.x, pointer.y, canvas, tiled, floating)
  if (target.kind !== 'free') return target
  const dockable = dockableTiles(sourcePaneId, tiled, floating)
  const hit = dockable.find((candidate) => inside(candidate.rect, pointer.x, pointer.y))
  if (hit) return crossDockBodyTarget(hit, pointer)
  const nearest = nearestDockableTile(dockable, pointer)
  return nearest ? crossDockGapTarget(nearest, pointer) : target
}

function tilesForTarget(tree: ChatLayout, browserVisible: boolean, canvas: { width: number; height: number }) {
  const geometry = layoutGeometry(tree, canvas.width, canvas.height)
  const tiles = canvasTiles(tree, geometry.panes, canvas, browserVisible)
  return {
    tiled: tiles.filter((tile) => tile.kind === 'tiled').map(({ id, rect }) => ({ id, rect })),
    floating: floatingFront(tiles)
  }
}

export function absorbCrossDockAtPointer(tree: ChatLayout, browserVisible: boolean, incomingPaneId: string, tabIds: readonly string[],
  pointer: { x: number; y: number }, canvas: { width: number; height: number }, splitId: string): ChatLayout {
  const { tiled, floating } = tilesForTarget(tree, browserVisible, canvas)
  const target = resolveCrossDockTarget(incomingPaneId, pointer, canvas, tiled, floating)
  if (target.kind === 'maximize') return tree
  return absorbCrossWindowDock(tree, incomingPaneId, tabIds, serializeWindowTarget(target), splitId, pointer, canvas)
}
