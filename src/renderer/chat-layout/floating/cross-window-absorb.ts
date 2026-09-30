import { adoptTabs } from '../layout-windows.js'
import { paneIds, type ChatLayout, type DockEdge } from '../layout-tree.js'
import { tabIds } from '../layout-tabs.js'
import type { SerializedWindowTarget } from '../../../shared/cross-window-dock.js'
import { floatWindow, windowMinimum } from './window-layout.js'

/** Insert chats from another window beside `target` on `edge`. */
export function dockIncomingPane(tree: ChatLayout, paneId: string, incomingTabs: readonly string[],
  target: string, edge: DockEdge, splitId: string): ChatLayout {
  const fresh = incomingTabs.filter((id) => !tabIds(tree).includes(id))
  if (!fresh.length || !paneIds(tree).includes(target)) return tree
  let id = paneIds(tree).includes(paneId) ? fresh[0]! : paneId
  if (paneIds(tree).includes(id)) id = `dock:${fresh[0]!}`
  const incoming: ChatLayout = { kind: 'pane', id, tabs: [...fresh] }
  const before = edge === 'left' || edge === 'top'
  const insert = (node: ChatLayout): ChatLayout => {
    if (node.kind === 'split') return { ...node, first: insert(node.first), second: insert(node.second) }
    if (node.id !== target) return node
    return { kind: 'split', id: splitId, ratio: 0.5,
      axis: edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical',
      first: before ? incoming : node, second: before ? node : incoming }
  }
  return insert(tree)
}

function floatIncoming(tree: ChatLayout, paneId: string, fresh: readonly string[],
  pointer: { x: number; y: number }, canvas: { width: number; height: number }): ChatLayout {
  let id = paneIds(tree).includes(paneId) ? fresh[0]! : paneId
  if (paneIds(tree).includes(id)) id = `dock:${fresh[0]!}`
  const minimum = windowMinimum(id)
  const width = Math.round(Math.max(minimum.width, canvas.width * 0.42))
  const height = Math.round(Math.max(minimum.height, canvas.height * 0.55))
  const x = Math.max(0, Math.min(pointer.x - width / 3, canvas.width - width))
  const y = Math.max(0, Math.min(pointer.y - 24, canvas.height - height))
  let next: ChatLayout = { kind: 'pane', id, tabs: [...fresh] }
  if (tree.kind === 'split') next = { kind: 'split', id: `dock-wrap:${id}`, axis: 'horizontal', ratio: 0.5, first: tree, second: next }
  else if (tree.kind === 'pane' && tree.id !== id) next = { kind: 'split', id: `dock-wrap:${id}`, axis: 'horizontal', ratio: 0.5, first: tree, second: next }
  return floatWindow(next, id, { x, y, width, height })
}

/** Apply a cross-window drop onto this window's layout tree. */
export function absorbCrossWindowDock(tree: ChatLayout, paneId: string, incomingTabIds: readonly string[],
  target: SerializedWindowTarget, splitId: string, pointer?: { x: number; y: number }, canvas?: { width: number; height: number }): ChatLayout {
  const fresh = incomingTabIds.filter((id) => !tabIds(tree).includes(id))
  if (!fresh.length) return tree
  let next = tree
  if (target.kind === 'group') next = adoptTabs(tree, fresh, target.target)
  else if (target.kind === 'split') next = dockIncomingPane(tree, paneId, fresh, target.target, target.edge, splitId)
  // Main has already moved these tabs to this window, so a drop that cannot be applied as aimed
  // floats them at the pointer rather than leaving them in no window's layout.
  if (next === tree && pointer && canvas) next = floatIncoming(tree, paneId, fresh, pointer, canvas)
  return next
}
