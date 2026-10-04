import { BROWSER_PANE_ID, isViewTabId, prunePanes, type ChatLayout } from './layout-tree.js'

// A docked group is a minimized window: kept in the tree at its place (tiled slot or floating
// rect) and listed in the app dock until it is restored.
export type DockGroup = Extract<ChatLayout, { kind: 'pane' }>

export function layoutGroups(tree: ChatLayout): DockGroup[] {
  return tree.kind === 'pane' ? tree.id === BROWSER_PANE_ID ? [] : [tree]
    : [...layoutGroups(tree.first), ...layoutGroups(tree.second)]
}

export function dockedGroups(tree: ChatLayout): DockGroup[] {
  return layoutGroups(tree).filter((group) => group.docked)
}

/**
 * The tiled layer: the tree without minimized or floating windows. The full tree is kept for
 * restoration and persistence; floating windows are laid out from their own rects.
 */
export function tiledTree(tree: ChatLayout): ChatLayout | null {
  return prunePanes(tree, outOfTiledLayer)
}

export function outOfTiledLayer(pane: DockGroup): boolean {
  return Boolean(pane.docked || pane.float)
}

export function expandedPaneIds(tree: ChatLayout): string[] {
  return layoutGroups(tree).filter((group) => !group.docked).map((group) => group.id)
}

export function setGroupDocked(tree: ChatLayout, id: string, docked: boolean): ChatLayout {
  const groups = layoutGroups(tree)
  const group = groups.find((item) => (item.tabs ?? [item.id]).includes(id))
  if (!group || Boolean(group.docked) === docked) return tree
  // Every window may minimize, leaving only the wallpaper, header and dock.
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
