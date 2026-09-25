import { setGroupDocked } from '../layout-docking.js'
import { BROWSER_PANE_ID, WORKSPACE_DOCK_ID, dockBrowser, dockPane, removePane, type ChatLayout, type DockEdge, type FloatRect, type Rect } from '../layout-tree.js'
import { moveTab, tabOwner } from '../layout-tabs.js'

// Tiles as windows. A tile is tiled (a slot in the split tree), floating (lifted out of the tiled
// layer into its own rect, stacked by z above every tiled window) or minimized (kept in the tree
// at its place and listed in the app dock). All three stay in one tree, so tabs, grouping,
// selection, pruning and persistence treat every window the same way.

export type WindowPane = Extract<ChatLayout, { kind: 'pane' }>
export type WindowSize = { width: number; height: number }
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** The window header's height: what must stay on the canvas so a window can be dragged back. */
export const WINDOW_HEADER = 38
/** How much of a window's width stays on the canvas when it is pushed past a side. */
const KEEP_VISIBLE = 96
/** Where a new window opens relative to the floating window it came from. */
const CASCADE = 32

export function windowMinimum(id: string): WindowSize {
  return { width: id === BROWSER_PANE_ID ? 384 : 300, height: 280 }
}

/** Every window, browser included, in tree order: the stable DOM order of the canvas. */
export function windowPanes(tree: ChatLayout): WindowPane[] {
  return tree.kind === 'pane' ? [tree] : [...windowPanes(tree.first), ...windowPanes(tree.second)]
}

export function findWindow(tree: ChatLayout, id: string): WindowPane | null {
  return windowPanes(tree).find((pane) => pane.id === id) ?? null
}

/** Floating windows on screen, back to front. */
export function floatingWindows(tree: ChatLayout): Array<WindowPane & { float: FloatRect }> {
  return windowPanes(tree)
    .filter((pane): pane is WindowPane & { float: FloatRect } => Boolean(pane.float) && !pane.docked)
    .sort((a, b) => a.float.z - b.float.z)
}

function mapWindow(tree: ChatLayout, id: string, change: (pane: WindowPane) => WindowPane): ChatLayout {
  if (tree.kind === 'pane') return tree.id === id ? change(tree) : tree
  const first = mapWindow(tree.first, id, change)
  const second = mapWindow(tree.second, id, change)
  return first === tree.first && second === tree.second ? tree : { ...tree, first, second }
}

function withoutFloat(pane: WindowPane): WindowPane {
  if (!pane.float) return pane
  const { float: _float, ...rest } = pane
  return rest
}

/** Renumber floating windows 1..n with `front` last, so z never grows without bound. */
function restack(tree: ChatLayout, front: string): ChatLayout {
  const order = floatingWindows(tree).map((pane) => pane.id).filter((id) => id !== front)
  if (findWindow(tree, front)?.float) order.push(front)
  const visit = (node: ChatLayout): ChatLayout => {
    if (node.kind === 'split') return { ...node, first: visit(node.first), second: visit(node.second) }
    const z = order.indexOf(node.id) + 1
    return z > 0 && node.float && node.float.z !== z ? { ...node, float: { ...node.float, z } } : node
  }
  return visit(tree)
}

/** Lift a window out of the tiled layer (or move a floating one) to `rect`, in front. */
export function floatWindow(tree: ChatLayout, id: string, rect: Rect): ChatLayout {
  const pane = findWindow(tree, id)
  if (!pane) return tree
  const { x, y, width, height } = rect
  return restack(mapWindow(tree, id, (node) => ({ ...node, float: { x, y, width, height, z: node.float?.z ?? 0 } })), id)
}

/** Bring a floating window to the front; the same tree when it already is, or is tiled. */
export function raiseWindow(tree: ChatLayout, id: string): ChatLayout {
  const stack = floatingWindows(tree)
  if (!stack.some((pane) => pane.id === id) || stack.at(-1)?.id === id) return tree
  return restack(tree, id)
}

/**
 * Put a window back into the tiled layer: beside `target` on `edge`, or as a full-height column
 * at the workspace edge when the target is WORKSPACE_DOCK_ID.
 */
export function snapWindow(tree: ChatLayout, id: string, target: string, edge: DockEdge, splitId: string): ChatLayout {
  if (id === target) return tree
  const cleared = mapWindow(tree, id, withoutFloat)
  if (id === BROWSER_PANE_ID) return dockBrowser(cleared, target, edge, splitId)
  if (target !== WORKSPACE_DOCK_ID) return dockPane(cleared, id, target, edge, splitId)
  const moved = findWindow(cleared, id)
  const rest = removePane(cleared, id)
  if (!moved || !rest) return cleared
  const before = edge === 'left' || edge === 'top'
  return { kind: 'split', id: splitId, ratio: 0.5, axis: edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical',
    first: before ? moved : rest, second: before ? rest : moved }
}

/** Join every tab of `source` to `target`'s tabs; the source's front tab stays in front. */
export function groupWindow(tree: ChatLayout, source: string, target: string): ChatLayout {
  if (source === target || source === BROWSER_PANE_ID || target === BROWSER_PANE_ID) return tree
  const pane = findWindow(tree, source)
  if (!pane || !tabOwner(tree, target)) return tree
  const tabs = pane.tabs ?? [pane.id]
  let next = tree
  for (const tab of [...tabs.filter((id) => id !== pane.id), pane.id]) next = moveTab(next, tab, target, null, '')
  return next
}

/** A window opened beside a floating one floats too, cascaded from it, instead of tiling. */
export function floatBeside(tree: ChatLayout, added: string, anchor: string): ChatLayout {
  const from = findWindow(tree, tabOwner(tree, anchor) ?? anchor)?.float
  const owner = tabOwner(tree, added)
  if (!from || !owner) return tree
  return floatWindow(tree, owner, { x: from.x + CASCADE, y: from.y + CASCADE, width: from.width, height: from.height })
}

export function minimizeWindow(tree: ChatLayout, id: string): ChatLayout {
  return id === BROWSER_PANE_ID ? tree : setGroupDocked(tree, id, true)
}

export function restoreWindow(tree: ChatLayout, id: string): ChatLayout {
  const restored = setGroupDocked(tree, id, false)
  const owner = tabOwner(restored, id)
  return owner ? raiseWindow(restored, owner) : restored
}

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), Math.max(low, high))

/** Where a floating window shows on `canvas`: never smaller than its floor, header always reachable. */
export function clampWindow(rect: Rect, canvas: WindowSize, minimum: WindowSize): Rect {
  if (canvas.width <= 0 || canvas.height <= 0) return rect
  const width = clamp(rect.width, minimum.width, canvas.width)
  const height = clamp(rect.height, minimum.height, canvas.height)
  return {
    x: clamp(rect.x, KEEP_VISIBLE - width, canvas.width - KEEP_VISIBLE),
    y: clamp(rect.y, 0, canvas.height - WINDOW_HEADER),
    width,
    height
  }
}

/**
 * The floating rect a tiled window takes when it is dragged out: a comfortable share of the
 * canvas, placed so the point under the pointer stays under it.
 */
export function tearOffRect(tile: Rect, canvas: WindowSize, pointer: { x: number; y: number }, minimum: WindowSize): Rect {
  const width = clamp(Math.min(tile.width, canvas.width * 0.45), minimum.width, tile.width)
  const height = clamp(Math.min(tile.height, canvas.height * 0.75), minimum.height, tile.height)
  const across = tile.width > 0 ? (pointer.x - tile.x) / tile.width : 0.5
  const down = Math.min(pointer.y - tile.y, WINDOW_HEADER - 8)
  return { x: Math.round(pointer.x - across * width), y: Math.round(pointer.y - down), width: Math.round(width), height: Math.round(height) }
}

/** `start` resized from `edge` by a pointer moved `dx`, `dy`; the opposite edges stay put. */
export function resizeRect(start: Rect, edge: ResizeEdge, dx: number, dy: number, minimum: WindowSize): Rect {
  let { x, y, width, height } = start
  if (edge.includes('e')) width = Math.max(minimum.width, start.width + dx)
  if (edge.includes('s')) height = Math.max(minimum.height, start.height + dy)
  if (edge.includes('w')) {
    width = Math.max(minimum.width, start.width - dx)
    x = start.x + start.width - width
  }
  if (edge.includes('n')) {
    height = Math.max(minimum.height, start.height - dy)
    y = start.y + start.height - height
  }
  return { x, y, width, height }
}
