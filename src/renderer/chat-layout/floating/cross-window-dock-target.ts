import type { SerializedWindowTarget } from '../../../shared/cross-window-dock.js'
import { layoutGeometry, type ChatLayout } from '../layout-tree.js'
import { absorbCrossWindowDock } from './cross-window-absorb.js'
import { canvasTiles, floatingFront } from './window-tiles.js'
import { WINDOW_HEADER } from './window-layout.js'
import { windowTargetAt, type WindowTarget, type WindowTile } from './window-targets.js'

const inside = (rect: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height

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
  const tile = tiled.find((candidate) => candidate.id !== sourcePaneId && inside(candidate.rect, pointer.x, pointer.y))
  if (!tile) return target
  const { rect } = tile
  if (pointer.y - rect.y < WINDOW_HEADER) return target
  const mid = rect.y + rect.height / 2
  return { kind: 'split', target: tile.id, edge: pointer.y < mid ? 'top' : 'bottom' }
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
