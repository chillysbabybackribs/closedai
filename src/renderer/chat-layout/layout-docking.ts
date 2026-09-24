import { BROWSER_PANE_ID, isViewTabId, type ChatLayout } from './layout-tree.js'

export const DOCK_HEIGHT = 36
export type DockGroup = Extract<ChatLayout, { kind: 'pane' }>

export function layoutGroups(tree: ChatLayout): DockGroup[] {
  return tree.kind === 'pane' ? tree.id === BROWSER_PANE_ID ? [] : [tree]
    : [...layoutGroups(tree.first), ...layoutGroups(tree.second)]
}

export function dockedGroups(tree: ChatLayout): DockGroup[] {
  return layoutGroups(tree).filter((group) => group.docked)
}

/** Subtrees that own a regional dock rail (a horizontal row or a vertical chat column). */
export function dockRailAnchors(node: ChatLayout): ChatLayout[] {
  if (node.kind === 'pane') return []
  if (hasBrowser(node)) return [...dockRailAnchors(node.first), ...dockRailAnchors(node.second)]
  if (!dockedGroups(node).length) return []
  const nested = [...dockRailAnchors(node.first), ...dockRailAnchors(node.second)]
  return nested.length ? nested : [node]
}

/** Vertical space reserved for dock rails beneath chat bands in this subtree. */
export function dockBandHeight(node: ChatLayout): number {
  if (node.kind === 'pane') return 0
  if (hasBrowser(node)) return Math.max(dockBandHeight(node.first), dockBandHeight(node.second))
  if (dockRailAnchors(node).includes(node)) return DOCK_HEIGHT
  return node.axis === 'vertical'
    ? dockBandHeight(node.first) + dockBandHeight(node.second)
    : Math.max(dockBandHeight(node.first), dockBandHeight(node.second))
}

export function hasBrowser(tree: ChatLayout): boolean {
  return tree.kind === 'pane' ? tree.id === BROWSER_PANE_ID : hasBrowser(tree.first) || hasBrowser(tree.second)
}

/** Project a region for display, retaining the full tree for restoration and persistence. */
export function expandedTree(tree: ChatLayout): ChatLayout | null {
  if (tree.kind === 'pane') return tree.docked ? null : tree
  const first = expandedTree(tree.first)
  const second = expandedTree(tree.second)
  return !first ? second : !second ? first : { ...tree, first, second }
}

export function expandedPaneIds(tree: ChatLayout): string[] {
  return layoutGroups(tree).filter((group) => !group.docked).map((group) => group.id)
}

export function setGroupDocked(tree: ChatLayout, id: string, docked: boolean): ChatLayout {
  const groups = layoutGroups(tree)
  const group = groups.find((item) => (item.tabs ?? [item.id]).includes(id))
  if (!group || Boolean(group.docked) === docked) return tree
  // Always keep an actual chat visible, even when other tiles show only views.
  if (docked && (expandedPaneIds(tree).length <= 1 || (!isViewTabId(group.id)
    && groups.filter((item) => !item.docked && !isViewTabId(item.id)).length <= 1))) return tree
  const used = new Set(groups.map((item) => item.dockNumber))
  let number = 1
  while (used.has(number)) number++
  const visit = (node: ChatLayout): ChatLayout => node.kind === 'pane'
    ? node === group ? { ...node, docked, dockNumber: node.dockNumber ?? number } : node
    : { ...node, first: visit(node.first), second: visit(node.second) }
  return visit(tree)
}

/** Removal/archive must never strand the remaining groups in the dock. */
export function ensureExpandedGroup(tree: ChatLayout): ChatLayout {
  const groups = layoutGroups(tree)
  if (groups.some((group) => !group.docked && !isViewTabId(group.id))) return tree
  const candidate = groups.find((group) => !isViewTabId(group.id)) ?? groups[0]
  return candidate ? setGroupDocked(tree, candidate.id, false) : tree
}
