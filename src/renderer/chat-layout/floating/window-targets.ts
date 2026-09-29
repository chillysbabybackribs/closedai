import { BROWSER_PANE_ID, WORKSPACE_DOCK_ID, layoutGeometry, removePane, type ChatLayout, type DockEdge, type Rect } from '../layout-tree.js'
import { snapToSide } from './window-arrange.js'
import { WINDOW_HEADER, findWindow, snapWindow } from './window-layout.js'

// Where a window being moved would land. The workspace edges snap it into the tiled layout (a
// full-height column, or half the workspace when nothing else is tiled; the top edge maximizes); a tiled window's outer band splits
// beside it; any window's tab strip joins its tabs. Everywhere else the window floats where it is
// dropped, so a floating window can sit over tiled ones without every pass turning into a split.

export type WindowTarget =
  | { kind: 'free' }
  | { kind: 'maximize' }
  /** `target` is a tiled window, or WORKSPACE_DOCK_ID for a full-height column. */
  | { kind: 'split'; target: string; edge: DockEdge }
  | { kind: 'group'; target: string }

export type WindowTile = { id: string; rect: Rect }

/** Pointer distance from a workspace side that snaps to a full-height column. */
export const EDGE_ZONE = 14
/** Deepest band inside a tiled window's edge that splits beside it. */
const SPLIT_BAND = 56

const inside = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height

/** Chats and views group with each other; the browser keeps its own tabs. */
const groupable = (source: string, target: string): boolean => source !== BROWSER_PANE_ID && target !== BROWSER_PANE_ID

/**
 * Resolve the pointer at `x`, `y` (canvas pixels) while `source` moves. `floating` is front to
 * back, so a floating window hides whatever lies under it.
 */
export function windowTargetAt(source: string, x: number, y: number, canvas: { width: number; height: number },
  tiled: readonly WindowTile[], floating: readonly WindowTile[]): WindowTarget {
  if (y <= 2) return { kind: 'maximize' }
  if (x <= EDGE_ZONE) return { kind: 'split', target: WORKSPACE_DOCK_ID, edge: 'left' }
  if (x >= canvas.width - EDGE_ZONE) return { kind: 'split', target: WORKSPACE_DOCK_ID, edge: 'right' }
  const over = floating.find((tile) => tile.id !== source && inside(tile.rect, x, y))
  if (over) {
    return y - over.rect.y < WINDOW_HEADER && groupable(source, over.id) ? { kind: 'group', target: over.id } : { kind: 'free' }
  }
  const tile = tiled.find((candidate) => candidate.id !== source && inside(candidate.rect, x, y))
  if (!tile) return { kind: 'free' }
  const { rect } = tile
  if (y - rect.y < WINDOW_HEADER && groupable(source, tile.id)) return { kind: 'group', target: tile.id }
  const distances: Record<DockEdge, number> = { left: x - rect.x, right: rect.x + rect.width - x, top: y - rect.y, bottom: rect.y + rect.height - y }
  const edge = (Object.keys(distances) as DockEdge[]).reduce((best, next) => distances[next] < distances[best] ? next : best)
  const band = Math.min(SPLIT_BAND, (edge === 'left' || edge === 'right' ? rect.width : rect.height) / 4)
  return distances[edge] <= band ? { kind: 'split', target: tile.id, edge } : { kind: 'free' }
}

export function sameTarget(a: WindowTarget, b: WindowTarget): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'split' && b.kind === 'split') return a.target === b.target && a.edge === b.edge
  if (a.kind === 'group' && b.kind === 'group') return a.target === b.target
  return true
}

/** Where a split target puts `source`: a workspace side snaps as snapToSide decides, anything else beside its target. */
export function snapTarget(tree: ChatLayout, source: string, target: Extract<WindowTarget, { kind: 'split' }>,
  canvas: { width: number; height: number }, tiled: readonly WindowTile[], floating: readonly WindowTile[], splitId: string): ChatLayout {
  const side = target.edge === 'left' || target.edge === 'right' ? target.edge : null
  return target.target === WORKSPACE_DOCK_ID && side
    ? snapToSide(tree, source, side, canvas, tiled, floating, splitId)
    : snapWindow(tree, source, target.target, target.edge, splitId)
}

/** The outline shown for a target: where the window would land, or the window it would join. */
export function targetPreview(tree: ChatLayout, source: string, target: WindowTarget, canvas: { width: number; height: number },
  browserVisible: boolean, tiled: readonly WindowTile[], floating: readonly WindowTile[]): Rect | null {
  if (target.kind === 'free') return null
  if (target.kind === 'maximize') return { x: 0, y: 0, width: canvas.width, height: canvas.height }
  if (target.kind === 'group') return [...tiled, ...floating].find((tile) => tile.id === target.target)?.rect ?? null
  const snapped = snapTarget(tree, source, target, canvas, tiled, floating, 'snap-preview')
  const float = findWindow(snapped, source)?.float
  if (float) return { x: float.x, y: float.y, width: float.width, height: float.height }
  const visible = browserVisible || source === BROWSER_PANE_ID ? snapped : removePane(snapped, BROWSER_PANE_ID)
  if (!visible) return null
  return layoutGeometry(visible, canvas.width, canvas.height).panes.find((pane) => pane.id === source)?.rect ?? null
}

export type JoinTabs = { target: string; incoming: string[] }

/**
 * The window a release would join and the tabs it would gain: a moving window over a tab strip
 * brings all its tabs, a dragged chat over another window's strip brings itself. `windows` are the
 * tiles on screen with their tabs.
 */
export function joinTabsTarget(windows: readonly { id: string; tabs: string[] }[],
  moving: { id: string; target: WindowTarget } | null,
  dragged: { id: string; drop: { target: string; edge: DockEdge | null } | null } | null): JoinTabs | null {
  const holding = (id: string) => windows.find((tile) => tile.id === id || tile.tabs.includes(id))
  if (moving?.target.kind === 'group') {
    const tabs = holding(moving.id)?.tabs
    return { target: moving.target.target, incoming: tabs?.length ? tabs : [moving.id] }
  }
  const drop = dragged?.drop
  if (!dragged || !drop || drop.edge !== null || drop.target === BROWSER_PANE_ID) return null
  const into = windows.find((tile) => tile.id === drop.target)
  return into && into !== holding(dragged.id) ? { target: into.id, incoming: [dragged.id] } : null
}
