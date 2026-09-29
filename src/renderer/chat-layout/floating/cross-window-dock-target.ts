import type { SerializedWindowTarget } from '../../../shared/cross-window-dock.js'
import { layoutGeometry, type ChatLayout } from '../layout-tree.js'
import { absorbCrossWindowDock } from './cross-window-absorb.js'
import { windowTargetAt, type WindowTarget, type WindowTile } from './window-targets.js'

export function serializeWindowTarget(target: WindowTarget): SerializedWindowTarget {
  if (target.kind === 'split') return { kind: 'split', target: target.target, edge: target.edge }
  if (target.kind === 'group') return { kind: 'group', target: target.target }
  if (target.kind === 'maximize') return { kind: 'maximize' }
  return { kind: 'free' }
}

export function resolveCrossDockTarget(sourcePaneId: string, pointer: { x: number; y: number }, canvas: { width: number; height: number },
  tiled: readonly WindowTile[], floating: readonly WindowTile[]): WindowTarget {
  return windowTargetAt(sourcePaneId, pointer.x, pointer.y, canvas, tiled, floating)
}

export function absorbCrossDockAtPointer(tree: ChatLayout, browserVisible: boolean, incomingPaneId: string, tabIds: readonly string[],
  pointer: { x: number; y: number }, canvas: { width: number; height: number }, splitId: string): ChatLayout {
  const geometry = layoutGeometry(tree, canvas.width, canvas.height)
  const tiled = geometry.panes.filter((pane) => !pane.float).map((pane) => ({ id: pane.id, rect: pane.rect }))
  const floating = geometry.panes.filter((pane) => pane.float).map((pane) => ({ id: pane.id, rect: pane.rect }))
  const probe = tabIds[0] ?? incomingPaneId
  const target = resolveCrossDockTarget(probe, pointer, canvas, tiled, floating)
  if (target.kind === 'free' || target.kind === 'maximize') return tree
  return absorbCrossWindowDock(tree, incomingPaneId, tabIds, serializeWindowTarget(target), splitId)
}
