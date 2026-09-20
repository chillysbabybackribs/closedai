import { BROWSER_PANE_ID, dockPane, replacePane, type ChatLayout, type DockEdge } from './layout-tree.js'

export const CHAT_TAB_DRAG_TYPE = 'application/x-closedai-chat-tab'

/** Move one conversation, preserving sibling tabs even when the source is active. */
export function moveTab(tree: ChatLayout, id: string, target: string, edge: DockEdge | null, splitId: string): ChatLayout {
  const destination = tabOwner(tree, target)
  if (!destination) return tree
  const siblings = tabIds(tree).filter((tab) => tab !== id && tabOwner(tree, tab) === destination)
  const anchor = destination === id ? siblings[0] : destination
  if (!anchor) return tree
  const remaining = removeTab(tree, id)
  if (!remaining) return tree
  const nextTarget = tabOwner(remaining, anchor)!
  return edge ? dockPane(remaining, id, nextTarget, edge, splitId) : addTab(remaining, nextTarget, id)
}

export function tabIds(tree: ChatLayout | null): string[] {
  if (!tree || tree.id === BROWSER_PANE_ID) return []
  return tree.kind === 'pane' ? tree.tabs ?? [tree.id] : [...tabIds(tree.first), ...tabIds(tree.second)]
}

export function tabOwner(tree: ChatLayout | null, id: string): string | null {
  if (!tree) return null
  return tree.kind === 'pane' ? (tree.tabs ?? [tree.id]).includes(id) ? tree.id : null
    : tabOwner(tree.first, id) ?? tabOwner(tree.second, id)
}

/** Select an existing tab wherever it lives; sidebar opens replace only the focused tab. */
export function selectTab(tree: ChatLayout, target: string, id: string): ChatLayout {
  const owner = tabOwner(tree, id)
  if (!owner) return replacePane(tree, target, id)
  const visit = (node: ChatLayout): ChatLayout => node.kind === 'pane'
    ? node.id === owner ? { ...node, id, tabs: node.tabs ?? [node.id] } : node
    : { ...node, first: visit(node.first), second: visit(node.second) }
  return visit(tree)
}

export function addTab(tree: ChatLayout, target: string, id: string): ChatLayout {
  if (tabOwner(tree, id)) return selectTab(tree, target, id)
  if (tree.kind === 'pane') return tree.id === target
    ? { ...tree, id, tabs: [...(tree.tabs ?? [tree.id]), id] } : tree
  return { ...tree, first: addTab(tree.first, target, id), second: addTab(tree.second, target, id) }
}

/** Closing the active tab selects its neighbor; only an empty tile collapses a split. */
export function removeTab(tree: ChatLayout | null, id: string): ChatLayout | null {
  if (!tree) return null
  if (tree.kind === 'pane') {
    const tabs = tree.tabs ?? [tree.id]
    const index = tabs.indexOf(id)
    if (index < 0) return tree
    const remaining = tabs.filter((tab) => tab !== id)
    return remaining.length ? { ...tree, tabs: remaining,
      id: tree.id === id ? remaining[Math.min(index, remaining.length - 1)]! : tree.id } : null
  }
  const first = removeTab(tree.first, id)
  const second = removeTab(tree.second, id)
  return !first ? second : !second ? first : first === tree.first && second === tree.second ? tree : { ...tree, first, second }
}

export function pruneTabs(tree: ChatLayout | null, available: Set<string>): ChatLayout | null {
  for (const id of tabIds(tree)) if (!available.has(id)) tree = removeTab(tree, id)
  return tree
}
