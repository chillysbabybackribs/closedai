import { isSidebarStack, sidebarScrollArea, type SidebarScrollArea } from './sidebar-stack.js'
import { layoutGroups, tiledTree } from './layout-docking.js'
import { MAIN_WINDOW_ID } from '../../shared/app-windows.js'
import { VIEW_TAB_PREFIX } from '../../shared/app-ui-events.js'
export type DockEdge = 'left' | 'right' | 'top' | 'bottom'
/** A floating window's place on the canvas; `z` orders floating windows, higher in front. */
export type FloatRect = { x: number; y: number; width: number; height: number; z: number }
/**
 * `docked` is a minimized window; `float` lifts a tile out of the tiled layer into its own rect;
 * `onTop` keeps the window above every window without it (Keep on top).
 */
export type ChatLayout = {
  kind: 'pane'; id: string; tabs?: string[]; docked?: boolean; dockNumber?: number; float?: FloatRect; onTop?: boolean
  /** A notepad window's chat (renderer notepad/): one per window, kept when its notes change. */
  notepadChat?: string
} | {
  kind: 'split'; id: string; axis: 'horizontal' | 'vertical'; ratio: number
  first: ChatLayout; second: ChatLayout
  /** Persistent tall main chat and independently scrolling side cards. */
  sidebarStack?: boolean
}
export type Rect = { x: number; y: number; width: number; height: number }
// Reserve the entire grab target: native browser views paint above renderer overlays.
export const DIVIDER_SIZE = 14
export const CHAT_DRAG_TYPE = 'application/x-closedai-chat'
// Reserved layout leaf: never sent to chat services or included in conversation tabs.
export const BROWSER_PANE_ID = 'closedai:shared-browser'
export const WORKSPACE_DOCK_ID = 'closedai:workspace-edge'
/** View tabs (trace, tools, …) share the tab strip with chats but are never chat ids for main. */
export { VIEW_TAB_PREFIX }

export function isReservedPaneId(id: string): boolean {
  return id === BROWSER_PANE_ID
}

export function isViewTabId(id: string): boolean {
  return id.startsWith(VIEW_TAB_PREFIX)
}

export function withBrowser(tree: ChatLayout): ChatLayout {
  if (layoutIds(tree).includes(BROWSER_PANE_ID)) return tree
  return { kind: 'split', id: 'closedai:browser-split', axis: 'horizontal', ratio: 0.6,
    first: tree, second: { kind: 'pane', id: BROWSER_PANE_ID } }
}

function layoutIds(tree: ChatLayout | null): string[] {
  return !tree ? [] : tree.kind === 'pane' ? [tree.id] : [...layoutIds(tree.first), ...layoutIds(tree.second)]
}

/** Tile ids: each tile is named by its active tab, which may be a view. */
export function paneIds(tree: ChatLayout | null): string[] {
  return layoutIds(tree).filter((id) => id !== BROWSER_PANE_ID)
}

/** Tiles whose active tab is a chat: what main treats as visible. */
export function chatPaneIds(tree: ChatLayout | null): string[] {
  return tree ? layoutGroups(tree).filter((group) => !group.docked && !isViewTabId(group.id)).map((group) => group.id) : []
}

export function removePane(tree: ChatLayout | null, id: string): ChatLayout | null {
  return tree ? prunePanes(tree, (pane) => pane.id === id) : null
}

type LayoutLeaf = Extract<ChatLayout, { kind: 'pane' }>
type Axis = 'horizontal' | 'vertical'
/** The share of a node's extent along each axis that its surviving panes held. */
type Span = Record<Axis, number>
type Pruned = { node: ChatLayout; span: Span }
const otherAxis = (axis: Axis): Axis => axis === 'horizontal' ? 'vertical' : 'horizontal'
const clampRatio = (ratio: number): number => Math.max(0.05, Math.min(0.95, ratio))

function pruneNode(node: ChatLayout, drop: (pane: LayoutLeaf) => boolean, spans?: Map<string, [number, number]>): Pruned | null {
  if (node.kind === 'pane') return drop(node) ? null : { node, span: { horizontal: 1, vertical: 1 } }
  const first = pruneNode(node.first, drop, spans)
  const second = pruneNode(node.second, drop, spans)
  const along = node.axis
  const across = otherAxis(along)
  if (!first || !second) {
    const kept = first ?? second
    if (!kept) return null
    const share = first ? node.ratio : 1 - node.ratio
    return { node: kept.node, span: { [along]: share * kept.span[along], [across]: kept.span[across] } as Span }
  }
  const a = first.span[along]
  const b = second.span[along]
  spans?.set(node.id, [a, b])
  const ratio = a === b ? node.ratio : clampRatio(node.ratio * a / (node.ratio * a + (1 - node.ratio) * b))
  const same = first.node === node.first && second.node === node.second && ratio === node.ratio
  return {
    node: same ? node : { ...node, ratio, first: first.node, second: second.node },
    span: { [along]: node.ratio * a + (1 - node.ratio) * b, [across]: Math.max(first.span[across], second.span[across]) } as Span
  }
}

/**
 * `tree` without the panes `drop` names. The space a removed pane held is shared by the panes left
 * in its row or column in proportion to their sizes, rather than all going to its nearest sibling,
 * and the tree it came from keeps its ratios, so showing the pane again restores the old sizes.
 */
export function prunePanes(tree: ChatLayout, drop: (pane: LayoutLeaf) => boolean): ChatLayout | null {
  return pruneNode(tree, drop)?.node ?? null
}

/**
 * The ratio split `id` stores so that, once `drop`'s panes are pruned, it shows `shown`: the
 * inverse of prunePanes, so a divider dragged while a window is hidden lands where it was let go.
 */
export function unprunedRatio(tree: ChatLayout, drop: (pane: LayoutLeaf) => boolean, id: string, shown: number): number {
  const spans = new Map<string, [number, number]>()
  pruneNode(tree, drop, spans)
  const [a, b] = spans.get(id) ?? [1, 1]
  return a === b ? shown : shown * b / (shown * b + (1 - shown) * a)
}

/** The row (horizontal) or column (vertical) members below `node`: subtrees not split along `axis`. */
function runMembers(node: ChatLayout, axis: Axis): ChatLayout[] {
  return node.kind === 'split' && node.axis === axis && !node.sidebarStack
    ? [...runMembers(node.first, axis), ...runMembers(node.second, axis)] : [node]
}

function runWeights(node: ChatLayout, axis: Axis, weight: number, out: Map<ChatLayout, number>): void {
  if (node.kind === 'split' && node.axis === axis && !node.sidebarStack) {
    runWeights(node.first, axis, weight * node.ratio, out)
    runWeights(node.second, axis, weight * (1 - node.ratio), out)
  } else out.set(node, weight)
}

function withRunWeights(node: ChatLayout, axis: Axis, weight: (member: ChatLayout) => number): ChatLayout {
  if (node.kind !== 'split' || node.axis !== axis || node.sidebarStack) return node
  const total = (child: ChatLayout) => runMembers(child, axis).reduce((sum, member) => sum + weight(member), 0)
  const a = total(node.first)
  const b = total(node.second)
  return { ...node, ratio: clampRatio(a / (a + b)),
    first: withRunWeights(node.first, axis, weight), second: withRunWeights(node.second, axis, weight) }
}

function splitHolding(node: ChatLayout, child: ChatLayout): Extract<ChatLayout, { kind: 'split' }> | null {
  if (node.kind === 'pane') return null
  return node.first === child || node.second === child ? node : splitHolding(node.first, child) ?? splitHolding(node.second, child)
}

/**
 * Give the window `id` an even share of the row or column it was just added to (the chain of
 * same-axis splits above it); the other members shrink in proportion and keep their relative sizes.
 */
export function evenShare(tree: ChatLayout, id: string): ChatLayout {
  const visit = (node: ChatLayout): ChatLayout => {
    if (node.kind === 'pane') return node
    if (!node.sidebarStack) {
      const leaf = runMembers(node, node.axis).find((member) => member.kind === 'pane' && member.id === id)
      if (leaf) {
        const weights = new Map<ChatLayout, number>()
        runWeights(node, node.axis, 1, weights)
        // The window it was split from takes back the half it gave, then shrinks with the rest.
        const parent = splitHolding(node, leaf)
        const target = parent && (parent.first === leaf ? parent.second : parent.first)
        if (target && weights.has(target)) {
          weights.set(target, weights.get(target)! + weights.get(leaf)!)
          weights.set(leaf, 0)
        }
        const share = 1 / weights.size
        const rest = 1 - weights.get(leaf)!
        if (rest <= 0) return node
        return withRunWeights(node, node.axis, (member) => member === leaf ? share : weights.get(member)! * (1 - share) / rest)
      }
    }
    const first = visit(node.first)
    const second = visit(node.second)
    return first === node.first && second === node.second ? node : { ...node, first, second }
  }
  return visit(tree)
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
  return evenShare({ kind: 'split', id: splitId, ratio: 0.5,
    axis: edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical',
    first: before ? browser : chats, second: before ? chats : browser }, BROWSER_PANE_ID)
}

export function resizeSplit(tree: ChatLayout, id: string, ratio: number): ChatLayout {
  if (tree.kind === 'pane') return tree
  if (tree.id === id) return { ...tree, ratio: Math.max(0.05, Math.min(0.95, ratio)) }
  return { ...tree, first: resizeSplit(tree.first, id, ratio), second: resizeSplit(tree.second, id, ratio) }
}

/** Smallest box a tiled layer fits; a floating window's floor is its own pane's. */
export function minimumSize(tree: ChatLayout): { width: number; height: number } {
  if (tree.kind === 'pane') return { width: tree.id === BROWSER_PANE_ID ? 384 : 300, height: 280 }
  const a = minimumSize(tree.first)
  const b = isSidebarStack(tree) ? { width: 300, height: 280 } : minimumSize(tree.second)
  return tree.axis === 'horizontal'
    ? { width: a.width + b.width + DIVIDER_SIZE, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height + DIVIDER_SIZE }
}

export type SplitRatioOverrides = Readonly<Record<string, number>>
export type SplitResizePhase = 'commit' | 'cancel'

type LayoutPane = { id: string; tabs: string[]; rect: Rect }
type LayoutDivider = { id: string; axis: 'horizontal' | 'vertical'; rect: Rect; parent: Rect; ratio: number; min: number; max: number }

function visitLayout(
  node: ChatLayout,
  rect: Rect,
  panes: LayoutPane[],
  dividers: LayoutDivider[],
  splitRatios: SplitRatioOverrides | undefined,
  clampMinimums: boolean,
  scrollAreas: SidebarScrollArea[],
): void {
  if (node.kind === 'pane') {
    panes.push({ id: node.id, tabs: node.tabs ?? [node.id], rect })
    return
  }
  const horizontal = node.axis === 'horizontal'
  const dimension = horizontal ? 'width' : 'height'
  const available = rect[dimension] - DIVIDER_SIZE
  let ratio = splitRatios?.[node.id] ?? node.ratio
  let min = 0
  let max = 1
  if (clampMinimums) {
    min = minimumSize(node.first)[dimension] / available
    max = 1 - (isSidebarStack(node) ? 300 : minimumSize(node.second)[dimension]) / available
    ratio = Math.max(min, Math.min(max, ratio))
  }
  const size = available * ratio
  const first = { ...rect, [dimension]: size }
  const second = { ...rect, [dimension]: available - size,
    [horizontal ? 'x' : 'y']: (horizontal ? rect.x : rect.y) + size + DIVIDER_SIZE }
  const divider = { ...rect, [dimension]: DIVIDER_SIZE,
    [horizontal ? 'x' : 'y']: (horizontal ? rect.x : rect.y) + size }
  dividers.push({ id: node.id, axis: node.axis, rect: divider, parent: rect, ratio, min, max })
  visitLayout(node.first, first, panes, dividers, splitRatios, clampMinimums, scrollAreas)
  if (isSidebarStack(node)) {
    const area = sidebarScrollArea(node, second)
    scrollAreas.push(area)
    const groups = layoutGroups(node.second)
    const tileHeight = (area.contentHeight - (groups.length - 1) * DIVIDER_SIZE) / groups.length
    groups.forEach((pane, index) => panes.push({ id: pane.id, tabs: pane.tabs ?? [pane.id],
      rect: { ...second, y: second.y + index * (tileHeight + DIVIDER_SIZE), height: tileHeight } }))
  } else visitLayout(node.second, second, panes, dividers, splitRatios, clampMinimums, scrollAreas)
}

/**
 * Flat geometry of the tiled layer; minimized and floating windows take no tiled space. Keeping
 * it flat keeps React pane keys and composer state stable across tree rearrangements.
 */
export function layoutGeometry(tree: ChatLayout | null, width: number, height: number, splitRatios?: SplitRatioOverrides) {
  const tiled = tree ? tiledTree(tree) : null
  const minimum = tiled ? minimumSize(tiled) : { width: 0, height: 0 }
  const canvas = { x: 0, y: 0, width: Math.max(width, minimum.width), height: Math.max(height, minimum.height) }
  const panes: LayoutPane[] = []
  const dividers: LayoutDivider[] = []
  const scrollAreas: SidebarScrollArea[] = []
  if (tiled) visitLayout(tiled, canvas, panes, dividers, splitRatios, true, scrollAreas)
  return { panes, dividers, minimum, scrollAreas }
}

/** A view pinned to one chat; unpinned views follow their tile and are absent here. */
export type ViewScopes = Record<string, { pinnedChatId: string }>
export type SavedChatLayout = {
  tree: ChatLayout | null
  browserVisible: boolean
  views?: ViewScopes
  /** The chat this window last had focused; main's one selection names only the window in front. */
  focused?: string
  /** The maximized window (a tile or one of its tabs), which fills the canvas until Escape. */
  maximized?: string
}
// Keyed by the main window's space (a project folder for spaces made before space ids); a detached
// window keeps its own layout for the project beside the main window's.
const storageKey = (key: string, windowId?: string): string =>
  `closedai.chat-layout.v1:${key}${windowId && windowId !== MAIN_WINDOW_ID ? `#window:${windowId}` : ''}`

function validViewScopes(raw: unknown, tabs: Set<string>): ViewScopes {
  const views: ViewScopes = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return views
  for (const [id, scope] of Object.entries(raw as Record<string, unknown>)) {
    const pinned = (scope as { pinnedChatId?: unknown } | null)?.pinnedChatId
    if (isViewTabId(id) && tabs.has(id) && typeof pinned === 'string' && tabs.has(pinned) && !isViewTabId(pinned)) {
      views[id] = { pinnedChatId: pinned }
    }
  }
  return views
}

function validFloat(float: unknown): boolean {
  if (!float || typeof float !== 'object') return false
  const { x, y, width, height, z } = float as Record<string, unknown>
  return [x, y, width, height].every((value) => typeof value === 'number' && Number.isFinite(value))
    && (width as number) > 0 && (height as number) > 0 && Number.isSafeInteger(z) && (z as number) >= 0
}

export function readLayout(storage: Pick<Storage, 'getItem'>, key: string, windowId?: string): SavedChatLayout {
  const fallback = { tree: null, browserVisible: true }
  try {
    const raw = JSON.parse(storage.getItem(storageKey(key, windowId)) ?? 'null') as SavedChatLayout | null
    const seen = new Set<string>()
    const chats = new Set<string>()
    const validate = (node: ChatLayout | null, depth = 0): boolean => {
      if (!node || depth > 32 || typeof node.id !== 'string' || !node.id || seen.has(node.id)) return false
      seen.add(node.id)
      if (node.kind === 'pane') {
        if (node.float !== undefined && !validFloat(node.float)) return false
        if (node.id === BROWSER_PANE_ID) return node.tabs === undefined && !node.docked && !node.onTop
        if (node.onTop !== undefined && typeof node.onTop !== 'boolean') return false
        if (node.docked !== undefined && typeof node.docked !== 'boolean') return false
        if (node.dockNumber !== undefined && (!Number.isSafeInteger(node.dockNumber) || node.dockNumber < 1)) return false
        if (node.notepadChat !== undefined && (typeof node.notepadChat !== 'string' || !node.notepadChat
          || isViewTabId(node.notepadChat) || isReservedPaneId(node.notepadChat))) return false
        const tabs = node.tabs ?? [node.id]
        if (!Array.isArray(tabs) || !tabs.includes(node.id) || !tabs.length) return false
        for (const id of tabs) {
          if (typeof id !== 'string' || !id || id === BROWSER_PANE_ID || chats.has(id)) return false
          chats.add(id)
        }
        return true
      }
      if (node.sidebarStack !== undefined && typeof node.sidebarStack !== 'boolean') return false
      return (node.kind === 'split' && ['horizontal', 'vertical'].includes(node.axis)
        && Number.isFinite(node.ratio) && node.ratio >= 0.05 && node.ratio <= 0.95
        && validate(node.first, depth + 1) && validate(node.second, depth + 1))
    }
    if (!raw || !(raw.tree === null || validate(raw.tree)) || typeof raw.browserVisible !== 'boolean') return fallback
    const views = validViewScopes(raw.views, chats)
    const focused = typeof raw.focused === 'string' && chats.has(raw.focused) && !isViewTabId(raw.focused) ? raw.focused : null
    const maximized = typeof raw.maximized === 'string' && (chats.has(raw.maximized) || raw.maximized === BROWSER_PANE_ID) ? raw.maximized : null
    return {
      tree: raw.tree, browserVisible: raw.browserVisible,
      ...(Object.keys(views).length ? { views } : {}),
      ...(focused ? { focused } : {}),
      ...(maximized ? { maximized } : {})
    }
  } catch { return fallback }
}

export function saveLayout(storage: Pick<Storage, 'setItem'>, key: string, layout: SavedChatLayout, windowId?: string): void {
  try { storage.setItem(storageKey(key, windowId), JSON.stringify(layout)) } catch { /* Best-effort preference. */ }
}
