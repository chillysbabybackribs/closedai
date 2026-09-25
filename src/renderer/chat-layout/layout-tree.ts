import { layoutGroups, tiledTree } from './layout-docking.js'
import { MAIN_WINDOW_ID } from '../../shared/app-windows.js'
export type DockEdge = 'left' | 'right' | 'top' | 'bottom'
/** A floating window's place on the canvas; `z` orders floating windows, higher in front. */
export type FloatRect = { x: number; y: number; width: number; height: number; z: number }
/** `docked` is a minimized window; `float` lifts a tile out of the tiled layer into its own rect. */
export type ChatLayout = { kind: 'pane'; id: string; tabs?: string[]; docked?: boolean; dockNumber?: number; float?: FloatRect } | {
  kind: 'split'; id: string; axis: 'horizontal' | 'vertical'; ratio: number
  first: ChatLayout; second: ChatLayout
}
export type Rect = { x: number; y: number; width: number; height: number }
// Reserve the entire grab target: native browser views paint above renderer overlays.
export const DIVIDER_SIZE = 14
export const CHAT_DRAG_TYPE = 'application/x-closedai-chat'
// Reserved layout leaf: never sent to chat services or included in conversation tabs.
export const BROWSER_PANE_ID = 'closedai:shared-browser'
export const WORKSPACE_DOCK_ID = 'closedai:workspace-edge'
/** View tabs (trace, tools, …) share the tab strip with chats but are never chat ids for main. */
export const VIEW_TAB_PREFIX = 'closedai:view:'

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

export function resizeSplit(tree: ChatLayout, id: string, ratio: number): ChatLayout {
  if (tree.kind === 'pane') return tree
  if (tree.id === id) return { ...tree, ratio: Math.max(0.05, Math.min(0.95, ratio)) }
  return { ...tree, first: resizeSplit(tree.first, id, ratio), second: resizeSplit(tree.second, id, ratio) }
}

/** Smallest box a tiled layer fits; a floating window's floor is its own pane's. */
export function minimumSize(tree: ChatLayout): { width: number; height: number } {
  if (tree.kind === 'pane') return { width: tree.id === BROWSER_PANE_ID ? 384 : 300, height: 280 }
  const a = minimumSize(tree.first)
  const b = minimumSize(tree.second)
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
    max = 1 - minimumSize(node.second)[dimension] / available
    ratio = Math.max(min, Math.min(max, ratio))
  }
  const size = available * ratio
  const first = { ...rect, [dimension]: size }
  const second = { ...rect, [dimension]: available - size,
    [horizontal ? 'x' : 'y']: (horizontal ? rect.x : rect.y) + size + DIVIDER_SIZE }
  const divider = { ...rect, [dimension]: DIVIDER_SIZE,
    [horizontal ? 'x' : 'y']: (horizontal ? rect.x : rect.y) + size }
  dividers.push({ id: node.id, axis: node.axis, rect: divider, parent: rect, ratio, min, max })
  visitLayout(node.first, first, panes, dividers, splitRatios, clampMinimums)
  visitLayout(node.second, second, panes, dividers, splitRatios, clampMinimums)
}

/**
 * Flat geometry of the tiled layer; minimized and floating windows take no tiled space. Keeping
 * it flat keeps React pane keys and composer state stable across tree rearrangements.
 */
export function layoutGeometry(tree: ChatLayout, width: number, height: number, splitRatios?: SplitRatioOverrides) {
  const tiled = tiledTree(tree)
  const minimum = tiled ? minimumSize(tiled) : { width: 0, height: 0 }
  const canvas = { x: 0, y: 0, width: Math.max(width, minimum.width), height: Math.max(height, minimum.height) }
  const panes: LayoutPane[] = []
  const dividers: LayoutDivider[] = []
  if (tiled) visitLayout(tiled, canvas, panes, dividers, splitRatios, true)
  return { panes, dividers, minimum }
}

/** A view pinned to one chat; unpinned views follow their tile and are absent here. */
export type ViewScopes = Record<string, { pinnedChatId: string }>
export type SavedChatLayout = { tree: ChatLayout | null; browserVisible: boolean; views?: ViewScopes }
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
      if (seen.size > 65) return false
      if (node.kind === 'pane') {
        if (node.float !== undefined && !validFloat(node.float)) return false
        if (node.id === BROWSER_PANE_ID) return node.tabs === undefined && !node.docked
        if (node.docked !== undefined && typeof node.docked !== 'boolean') return false
        if (node.dockNumber !== undefined && (!Number.isSafeInteger(node.dockNumber) || node.dockNumber < 1)) return false
        const tabs = node.tabs ?? [node.id]
        if (!Array.isArray(tabs) || !tabs.includes(node.id) || !tabs.length) return false
        for (const id of tabs) {
          if (typeof id !== 'string' || !id || id === BROWSER_PANE_ID || chats.has(id)) return false
          chats.add(id)
        }
        return true
      }
      return (node.kind === 'split' && ['horizontal', 'vertical'].includes(node.axis)
        && Number.isFinite(node.ratio) && node.ratio >= 0.05 && node.ratio <= 0.95
        && validate(node.first, depth + 1) && validate(node.second, depth + 1))
    }
    if (!raw || !(raw.tree === null || validate(raw.tree)) || typeof raw.browserVisible !== 'boolean') return fallback
    const views = validViewScopes(raw.views, chats)
    return Object.keys(views).length ? { tree: raw.tree, browserVisible: raw.browserVisible, views }
      : { tree: raw.tree, browserVisible: raw.browserVisible }
  } catch { return fallback }
}

export function saveLayout(storage: Pick<Storage, 'setItem'>, key: string, layout: SavedChatLayout, windowId?: string): void {
  try { storage.setItem(storageKey(key, windowId), JSON.stringify(layout)) } catch { /* Best-effort preference. */ }
}
