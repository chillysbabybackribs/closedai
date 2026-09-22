export type DockEdge = 'left' | 'right' | 'top' | 'bottom'
export type ChatLayout = { kind: 'pane'; id: string; tabs?: string[] } | {
  kind: 'split'; id: string; axis: 'horizontal' | 'vertical'; ratio: number
  first: ChatLayout; second: ChatLayout
}
export type Rect = { x: number; y: number; width: number; height: number }
// Reserve the entire grab target: native browser views paint above renderer overlays.
export const DIVIDER_SIZE = 14
export const CHAT_DRAG_TYPE = 'application/x-closedai-chat'
// Reserved layout leaves: never sent to chat services or included in conversation tabs.
export const BROWSER_PANE_ID = 'closedai:shared-browser'
export const AGENT_WORKSPACE_PANE_ID = 'closedai:agent-workspace'
export const WORKSPACE_DOCK_ID = 'closedai:workspace-edge'

export function isReservedPaneId(id: string): boolean {
  return id === BROWSER_PANE_ID || id === AGENT_WORKSPACE_PANE_ID
}

export function withBrowser(tree: ChatLayout): ChatLayout {
  if (layoutIds(tree).includes(BROWSER_PANE_ID)) return tree
  return { kind: 'split', id: 'closedai:browser-split', axis: 'horizontal', ratio: 0.6,
    first: tree, second: { kind: 'pane', id: BROWSER_PANE_ID } }
}

/** Inserts the agent workspace as a left column when the user first opens it. */
export function withAgent(tree: ChatLayout): ChatLayout {
  if (layoutIds(tree).includes(AGENT_WORKSPACE_PANE_ID)) return tree
  return { kind: 'split', id: 'closedai:agent-split', axis: 'horizontal', ratio: 0.38,
    first: { kind: 'pane', id: AGENT_WORKSPACE_PANE_ID }, second: tree }
}

export function layoutIds(tree: ChatLayout | null): string[] {
  return !tree ? [] : tree.kind === 'pane' ? [tree.id] : [...layoutIds(tree.first), ...layoutIds(tree.second)]
}

export function paneIds(tree: ChatLayout | null): string[] {
  return layoutIds(tree).filter((id) => !isReservedPaneId(id))
}

export function hiddenReservedPanes(tree: ChatLayout, browserVisible: boolean, agentVisible: boolean): string[] {
  const hidden: string[] = []
  if (layoutIds(tree).includes(BROWSER_PANE_ID) && !browserVisible) hidden.push(BROWSER_PANE_ID)
  if (layoutIds(tree).includes(AGENT_WORKSPACE_PANE_ID) && !agentVisible) hidden.push(AGENT_WORKSPACE_PANE_ID)
  return hidden
}

export function layoutForGeometry(tree: ChatLayout, browserVisible: boolean, agentVisible: boolean): ChatLayout {
  let next = tree
  for (const id of hiddenReservedPanes(tree, browserVisible, agentVisible)) next = removePane(next, id)!
  return next
}

export function removePane(tree: ChatLayout | null, id: string): ChatLayout | null {
  if (!tree || tree.kind === 'pane') return tree?.id === id ? null : tree
  const first = removePane(tree.first, id)
  const second = removePane(tree.second, id)
  return !first ? second : !second ? first : { ...tree, first, second }
}

export function replacePane(tree: ChatLayout, target: string, id: string): ChatLayout {
  if (tree.kind === 'pane') return tree.id === target ? { ...tree, id,
    ...(tree.tabs ? { tabs: tree.tabs.map((tab) => tab === target ? id : tab) } : {}) } : tree
  return { ...tree, first: replacePane(tree.first, target, id), second: replacePane(tree.second, target, id) }
}

/** Moving an existing pane removes its old slot first, collapsing any empty split. */
export function dockPane(tree: ChatLayout | null, id: string, target: string, edge: DockEdge, splitId: string): ChatLayout {
  if (!tree) return { kind: 'pane', id }
  if (id === target || !layoutIds(tree).includes(target)) return tree
  const source = (node: ChatLayout): ChatLayout | null => node.kind === 'pane'
    ? node.id === id ? node : null : source(node.first) ?? source(node.second)
  const moved = source(tree)
  const pruned = removePane(tree, id)!
  const insert = (node: ChatLayout): ChatLayout => {
    if (node.kind === 'split') return { ...node, first: insert(node.first), second: insert(node.second) }
    if (node.id !== target) return node
    const added: ChatLayout = moved ?? { kind: 'pane', id }
    const before = edge === 'left' || edge === 'top'
    return { kind: 'split', id: splitId, ratio: 0.5,
      axis: edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical',
      first: before ? added : node, second: before ? node : added }
  }
  return insert(pruned)
}

/** The browser moves without selecting or opening a conversation. */
export function dockBrowser(tree: ChatLayout, target: string, edge: DockEdge, splitId: string): ChatLayout {
  if (!layoutIds(tree).includes(BROWSER_PANE_ID)) return tree
  if (target !== WORKSPACE_DOCK_ID) return dockPane(tree, BROWSER_PANE_ID, target, edge, splitId)
  const chats = removePane(tree, BROWSER_PANE_ID)
  if (!chats) return tree
  const browser: ChatLayout = { kind: 'pane', id: BROWSER_PANE_ID }
  const before = edge === 'left' || edge === 'top'
  return { kind: 'split', id: splitId, ratio: 0.5,
    axis: edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical',
    first: before ? browser : chats, second: before ? chats : browser }
}

export function dockAgent(tree: ChatLayout, target: string, edge: DockEdge, splitId: string): ChatLayout {
  if (!layoutIds(tree).includes(AGENT_WORKSPACE_PANE_ID)) return tree
  if (target !== WORKSPACE_DOCK_ID) return dockPane(tree, AGENT_WORKSPACE_PANE_ID, target, edge, splitId)
  const chats = removePane(tree, AGENT_WORKSPACE_PANE_ID)
  if (!chats) return tree
  const agent: ChatLayout = { kind: 'pane', id: AGENT_WORKSPACE_PANE_ID }
  const before = edge === 'left' || edge === 'top'
  return { kind: 'split', id: splitId, ratio: 0.5,
    axis: edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical',
    first: before ? agent : chats, second: before ? chats : agent }
}

export function resizeSplit(tree: ChatLayout, id: string, ratio: number): ChatLayout {
  if (tree.kind === 'pane') return tree
  if (tree.id === id) return { ...tree, ratio: Math.max(0.05, Math.min(0.95, ratio)) }
  return { ...tree, first: resizeSplit(tree.first, id, ratio), second: resizeSplit(tree.second, id, ratio) }
}

export function minimumSize(tree: ChatLayout): { width: number; height: number } {
  if (tree.kind === 'pane') {
    if (tree.id === BROWSER_PANE_ID) return { width: 384, height: 280 }
    if (tree.id === AGENT_WORKSPACE_PANE_ID) return { width: 420, height: 280 }
    return { width: 300, height: 280 }
  }
  const a = minimumSize(tree.first)
  const b = minimumSize(tree.second)
  return tree.axis === 'horizontal'
    ? { width: a.width + b.width + DIVIDER_SIZE, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height + DIVIDER_SIZE }
}

/** Flat geometry keeps React pane keys and composer state stable across tree rearrangements. */
export function layoutGeometry(tree: ChatLayout, width: number, height: number) {
  const panes: Array<{ id: string; tabs: string[]; rect: Rect }> = []
  const dividers: Array<{ id: string; axis: 'horizontal' | 'vertical'; rect: Rect; parent: Rect; ratio: number; min: number; max: number }> = []
  const visit = (node: ChatLayout, rect: Rect): void => {
    if (node.kind === 'pane') { panes.push({ id: node.id, tabs: node.tabs ?? [node.id], rect }); return }
    const horizontal = node.axis === 'horizontal'
    const dimension = horizontal ? 'width' : 'height'
    const available = rect[dimension] - DIVIDER_SIZE
    const min = minimumSize(node.first)[dimension] / available
    const max = 1 - minimumSize(node.second)[dimension] / available
    const ratio = Math.max(min, Math.min(max, node.ratio))
    const size = available * ratio
    const first = { ...rect, [dimension]: size }
    const second = { ...rect, [dimension]: available - size,
      [horizontal ? 'x' : 'y']: (horizontal ? rect.x : rect.y) + size + DIVIDER_SIZE }
    const divider = { ...rect, [dimension]: DIVIDER_SIZE,
      [horizontal ? 'x' : 'y']: (horizontal ? rect.x : rect.y) + size }
    dividers.push({ id: node.id, axis: node.axis, rect: divider, parent: rect, ratio, min, max })
    visit(node.first, first)
    visit(node.second, second)
  }
  const minimum = minimumSize(tree)
  visit(tree, { x: 0, y: 0, width: Math.max(width, minimum.width), height: Math.max(height, minimum.height) })
  return { panes, dividers, minimum }
}

export type SavedChatLayout = { tree: ChatLayout | null; browserVisible: boolean; agentVisible: boolean }
const storageKey = (cwd: string): string => `closedai.chat-layout.v1:${cwd}`

export function readLayout(storage: Pick<Storage, 'getItem'>, cwd: string): SavedChatLayout {
  const fallback = { tree: null, browserVisible: true, agentVisible: false }
  try {
    const raw = JSON.parse(storage.getItem(storageKey(cwd)) ?? 'null') as SavedChatLayout | null
    const seen = new Set<string>()
    const chats = new Set<string>()
    const validate = (node: ChatLayout | null, depth = 0): boolean => {
      if (!node || depth > 32 || typeof node.id !== 'string' || !node.id || seen.has(node.id)) return false
      seen.add(node.id)
      if (seen.size > 65) return false
      if (node.kind === 'pane') {
        if (isReservedPaneId(node.id)) return node.tabs === undefined
        const tabs = node.tabs ?? [node.id]
        if (!Array.isArray(tabs) || !tabs.includes(node.id) || !tabs.length) return false
        for (const id of tabs) {
          if (typeof id !== 'string' || !id || isReservedPaneId(id) || chats.has(id)) return false
          chats.add(id)
        }
        return true
      }
      return (node.kind === 'split' && ['horizontal', 'vertical'].includes(node.axis)
        && Number.isFinite(node.ratio) && node.ratio >= 0.05 && node.ratio <= 0.95
        && validate(node.first, depth + 1) && validate(node.second, depth + 1))
    }
    if (!raw || (raw.tree !== null && !validate(raw.tree)) || typeof raw.browserVisible !== 'boolean') return fallback
    return { tree: raw.tree, browserVisible: raw.browserVisible, agentVisible: raw.agentVisible === true }
  } catch { return fallback }
}

export function saveLayout(storage: Pick<Storage, 'setItem'>, cwd: string, layout: SavedChatLayout): void {
  try { storage.setItem(storageKey(cwd), JSON.stringify(layout)) } catch { /* Best-effort preference. */ }
}
