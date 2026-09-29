import { adoptTabs } from '../layout-windows.js'
import { paneIds, type ChatLayout, type DockEdge } from '../layout-tree.js'
import { tabIds } from '../layout-tabs.js'
import type { SerializedWindowTarget } from '../../../shared/cross-window-dock.js'

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

/** Apply a cross-window drop onto this window's layout tree. */
export function absorbCrossWindowDock(tree: ChatLayout, paneId: string, incomingTabIds: readonly string[],
  target: SerializedWindowTarget, splitId: string): ChatLayout {
  const fresh = incomingTabIds.filter((id) => !tabIds(tree).includes(id))
  if (!fresh.length || target.kind === 'free' || target.kind === 'maximize') return tree
  if (target.kind === 'group') return adoptTabs(tree, fresh, target.target)
  return dockIncomingPane(tree, paneId, fresh, target.target, target.edge, splitId)
}
