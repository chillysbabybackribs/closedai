import { BROWSER_PANE_ID, isViewTabId, type ChatLayout } from './layout-tree.js'

export const DOCK_HEIGHT = 36
export type DockGroup = Extract<ChatLayout, { kind: 'pane' }>
type LayoutRect = { x: number; y: number; width: number; height: number }
export type DockRail = { id: string; groups: DockGroup[]; rect: LayoutRect; boundary: LayoutRect }

export function layoutGroups(tree: ChatLayout): DockGroup[] {
  return tree.kind === 'pane' ? tree.id === BROWSER_PANE_ID ? [] : [tree]
    : [...layoutGroups(tree.first), ...layoutGroups(tree.second)]
}

export function dockedGroups(tree: ChatLayout): DockGroup[] {
  return layoutGroups(tree).filter((group) => group.docked)
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

function unionRect(rects: LayoutRect[]): LayoutRect {
  const first = rects[0]!
  let { x, y, width, height } = first
  for (const rect of rects.slice(1)) {
    const right = Math.max(x + width, rect.x + rect.width)
    const bottom = Math.max(y + height, rect.y + rect.height)
    x = Math.min(x, rect.x)
    y = Math.min(y, rect.y)
    width = right - x
    height = bottom - y
  }
  return { x, y, width, height }
}

function groupInRow(group: DockGroup, rowPanes: Array<{ id: string; tabs: string[] }>): boolean {
  return rowPanes.some((pane) => pane.id === group.id || (group.tabs ?? [group.id]).some((tab) => pane.tabs.includes(tab)))
}

/** One rail per horizontal row of chat tiles that contains a docked group; browser columns are excluded. */
export function dockRowRails(
  panes: Array<{ id: string; tabs: string[]; rect: LayoutRect }>,
  docked: DockGroup[],
): DockRail[] {
  if (!docked.length) return []
  const chatPanes = panes.filter((pane) => pane.id !== BROWSER_PANE_ID)
  const rows = new Map<string, typeof chatPanes>()
  for (const pane of chatPanes) {
    const key = `${pane.rect.y}|${pane.rect.height}`
    const list = rows.get(key) ?? []
    list.push(pane)
    rows.set(key, list)
  }
  const rails: DockRail[] = []
  for (const rowPanes of rows.values()) {
    const groups = docked.filter((group) => groupInRow(group, rowPanes))
    if (!groups.length) continue
    const boundary = unionRect(rowPanes.map((pane) => pane.rect))
    rails.push({
      id: `dock-row-${boundary.y}`,
      groups,
      boundary,
      rect: { ...boundary, y: boundary.y + boundary.height - DOCK_HEIGHT, height: DOCK_HEIGHT },
    })
  }
  return rails.sort((left, right) => left.boundary.y - right.boundary.y)
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
