import { sideChatTree } from './sidebar-stack.js'
import { BROWSER_PANE_ID, DIVIDER_SIZE, withBrowser, type ChatLayout } from './layout-tree.js'

export type LayoutPreset = { kind: 'browser-centre' } | { kind: 'grid'; count: number } | { kind: 'browser-side' } | { kind: 'browser-between' }
export type CanvasSize = { width: number; height: number }
export type Grid = { cols: number; rows: number; tileWidth: number; tileHeight: number }
/** One tile's conversations in strip order, with its active tab. */
export type TileGroup = { active: string; tabs: string[] }

/** Hard tile minimums match `minimumSize`; the comfortable size is where a chat stops feeling cramped. */
const MIN_TILE = { width: 300, height: 280 }
export const COMFORTABLE_TILE = { width: 440, height: 480 }
/** More empty chats than this is never a useful starting point, whatever the screen fits. */
export const GRID_CHAT_CAP = 12
export const BROWSER_CENTRE_SLOTS = 4
export const BROWSER_SIDE_SLOTS = 1
export const BROWSER_BETWEEN_SLOTS = 2
const BROWSER_CENTRE_RATIO = 0.42
// Same split the browser toggle opens on a single chat, so the preset feels like the toggle's own arrangement.
const BROWSER_SIDE_RATIO = 0.6

/**
 * Columns and rows for `count` chats: the largest comfortable tile wins, then the fewest empty
 * cells, then the squarer tile. Null when the canvas cannot hold `count` tiles at the minimum.
 */
export function chooseGrid(count: number, size: CanvasSize): Grid | null {
  let best: (Grid & { comfort: number; empty: number; aspectGap: number }) | null = null
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const tileWidth = (size.width - (cols - 1) * DIVIDER_SIZE) / cols
    const tileHeight = (size.height - (rows - 1) * DIVIDER_SIZE) / rows
    if (tileWidth < MIN_TILE.width || tileHeight < MIN_TILE.height) continue
    const comfort = Math.min(tileWidth / COMFORTABLE_TILE.width, 1) * Math.min(tileHeight / COMFORTABLE_TILE.height, 1)
    const empty = cols * rows - count
    const aspectGap = Math.abs(Math.log(tileWidth / tileHeight))
    const better = !best || comfort > best.comfort + 1e-6 || (Math.abs(comfort - best.comfort) < 1e-6
      && (empty < best.empty || (empty === best.empty && aspectGap < best.aspectGap)))
    if (better) best = { cols, rows, tileWidth, tileHeight, comfort, empty, aspectGap }
  }
  return best && { cols: best.cols, rows: best.rows, tileWidth: best.tileWidth, tileHeight: best.tileHeight }
}

/** Most chats the grid option offers on this canvas. */
export function gridCapacity(size: CanvasSize): number {
  let count = 1
  while (count < GRID_CHAT_CAP && chooseGrid(count + 1, size)) count++
  return count
}

export function clampGridCount(count: number, size: CanvasSize): number {
  return Math.min(gridCapacity(size), Math.max(1, Math.floor(Number.isFinite(count) ? count : 1)))
}

/** Every expanded window (not minimized), in tree order; the browser is excluded. */
export function assignExpandedGroups(tree: ChatLayout | null): TileGroup[] {
  const groups: TileGroup[] = []
  const visit = (node: ChatLayout): void => {
    if (node.kind === 'split') { visit(node.first); visit(node.second); return }
    if (node.id === BROWSER_PANE_ID || node.docked) return
    const tabs = node.tabs ?? [node.id]
    groups.push({ active: node.id, tabs: [...tabs] })
  }
  if (tree) visit(tree)
  return groups
}

/** Put the group containing `focusId` first so it lands in the primary tile. */
export function rotateGroupsToFront(groups: readonly TileGroup[], focusId: string): TileGroup[] {
  const index = groups.findIndex((group) => group.active === focusId || group.tabs.includes(focusId))
  if (index <= 0) return [...groups]
  return [...groups.slice(index), ...groups.slice(0, index)]
}

export type FitLayoutBuilder = (groups: readonly TileGroup[], size: CanvasSize, newId: () => string) => ChatLayout

/** Stable key for the expanded desk: which windows are out of the dock and whether the browser shows. */
export function fitDeskSignature(groups: readonly TileGroup[], browserVisible: boolean): string {
  return `${[...groups].map((group) => group.active).sort().join('\0')}\0${browserVisible ? '1' : '0'}`
}

function chatPairLayout(groups: readonly TileGroup[], size: CanvasSize, axis: 'horizontal' | 'vertical', newId: () => string): ChatLayout {
  const nodes = groups.map(pane)
  return strip(nodes, axis, axis === 'horizontal' ? size.width : size.height, newId)
}

function stripFits(count: number, size: CanvasSize, axis: 'horizontal' | 'vertical'): boolean {
  if (count <= 1) return false
  const extent = axis === 'horizontal' ? size.width : size.height
  const tile = (extent - (count - 1) * DIVIDER_SIZE) / count
  return tile >= (axis === 'horizontal' ? MIN_TILE.width : MIN_TILE.height)
}

/** Equal tiles in one row or one column (browser excluded). */
export function chatStripLayout(groups: readonly TileGroup[], size: CanvasSize, axis: 'horizontal' | 'vertical', newId: () => string): ChatLayout {
  return strip(groups.map(pane), axis, axis === 'horizontal' ? size.width : size.height, newId)
}

function sidebarStackFits(count: number, size: CanvasSize): boolean {
  if (count < 3) return false
  const leadWidth = Math.max(MIN_TILE.width, Math.round(size.width * 0.38))
  const tailWidth = size.width - leadWidth - DIVIDER_SIZE
  if (tailWidth < MIN_TILE.width) return false
  return size.height >= MIN_TILE.height
}

/** One full-height chat beside the rest in a vertical column (when a single column of all chats cannot fit). */
export function sidebarStackLayout(groups: readonly TileGroup[], size: CanvasSize, newId: () => string): ChatLayout {
  const [lead, ...tail] = groups
  const leadWidth = Math.max(MIN_TILE.width, Math.round(size.width * 0.38))
  const tailTree = sideChatTree(tail.map((group) => ({ kind: 'pane', id: group.active, tabs: group.tabs })), newId)
  return { kind: 'split', id: newId(), axis: 'horizontal', ratio: clampRatio(leadWidth / (size.width - DIVIDER_SIZE)),
    first: pane(lead!), second: tailTree, sidebarStack: true }
}

export function canUseSidebarStackLayout(groupCount: number, size: CanvasSize): boolean {
  return sidebarStackFits(groupCount, size)
}

/** Tall lead tile for `leadId`, remaining chats in a vertical stack (browser excluded from groups). */
export function sidebarStackForLead(
  groups: readonly TileGroup[],
  size: CanvasSize,
  leadId: string,
  newId: () => string
): ChatLayout | null {
  if (!sidebarStackFits(groups.length, size)) return null
  return sidebarStackLayout(rotateGroupsToFront(groups, leadId), size, newId)
}

function noBrowserDeskVariants(count: number, size: CanvasSize): FitLayoutBuilder[] {
  const variants: FitLayoutBuilder[] = [(g, s, id) => gridLayout(g, s, id)]
  if (stripFits(count, size, 'vertical')) variants.push((g, s, id) => chatStripLayout(g, s, 'vertical', id))
  else if (sidebarStackFits(count, size)) variants.push((g, s, id) => sidebarStackLayout(g, s, id))
  if (stripFits(count, size, 'horizontal')) variants.push((g, s, id) => chatStripLayout(g, s, 'horizontal', id))
  return variants
}

/**
 * Layout variants double-click cycles through for the same set of expanded windows. Two-window desks
 * get horizontal vs vertical (or browser-between vs stacked-left); larger desks alternate presets.
 */
export function fitLayoutVariants(groups: readonly TileGroup[], size: CanvasSize, browserVisible: boolean): readonly FitLayoutBuilder[] {
  const count = groups.length
  if (count <= 1) return []
  if (!browserVisible) {
    if (count === 2) {
      return [
        (g, s, id) => chatPairLayout(g, s, 'horizontal', id),
        (g, s, id) => chatPairLayout(g, s, 'vertical', id)
      ]
    }
    return noBrowserDeskVariants(count, size)
  }
  if (count === 2) {
    return [
      (g, s, id) => browserBetweenLayout(g, s, id),
      (g, s, id) => withBrowser(chatPairLayout(g, s, 'vertical', id))
    ]
  }
  if (count === 3) {
    return [
      (g, s, id) => browserThreeLayout(g, s, id),
      (g, s, id) => withBrowser(gridLayout(g, s, id))
    ]
  }
  if (count === 4) {
    return [
      (g, s, id) => browserCentreLayout(g, s, id),
      (g, s, id) => withBrowser(gridLayout(g, s, id))
    ]
  }
  return [(g, s, id) => withBrowser(gridLayout(g, s, id))]
}

/** First variant from {@link fitLayoutVariants}; used in tests and one-shot fit helpers. */
export function fitExpandedWindowsTree(tree: ChatLayout, size: CanvasSize, browserVisible: boolean, focusId: string, newId: () => string): ChatLayout | null {
  const groups = rotateGroupsToFront(assignExpandedGroups(tree), focusId)
  const variants = fitLayoutVariants(groups, size, browserVisible)
  if (!variants.length) return null
  return variants[0]!(groups, size, newId)
}

/** One chat, the browser, and two stacked chats; expects exactly three groups. */
export function browserThreeLayout(groups: readonly TileGroup[], size: CanvasSize, newId: () => string): ChatLayout {
  const [a, b, c] = groups.map(pane) as [ChatLayout, ChatLayout, ChatLayout]
  const browserWidth = Math.round(size.width * BROWSER_CENTRE_RATIO)
  const sideWidth = (size.width - browserWidth - 2 * DIVIDER_SIZE) / 2
  const right = strip([b, c], 'vertical', size.height, newId)
  const browserAndRight: ChatLayout = { kind: 'split', id: newId(), axis: 'horizontal',
    ratio: clampRatio(browserWidth / (size.width - sideWidth - 2 * DIVIDER_SIZE)),
    first: { kind: 'pane', id: BROWSER_PANE_ID }, second: right }
  return { kind: 'split', id: newId(), axis: 'horizontal', ratio: clampRatio(sideWidth / (size.width - DIVIDER_SIZE)),
    first: a, second: browserAndRight }
}

/** Each visible tile keeps its tab group; groups beyond `slots` merge into the last kept group. */
export function assignGroups(tree: ChatLayout | null, slots: number): { groups: TileGroup[]; missing: number } {
  const groups: TileGroup[] = []
  const visit = (node: ChatLayout): void => {
    if (node.kind === 'split') { visit(node.first); visit(node.second); return }
    if (node.id === BROWSER_PANE_ID) return
    const tabs = node.tabs ?? [node.id]
    if (groups.length < slots) groups.push({ active: node.id, tabs: [...tabs] })
    else groups[groups.length - 1]!.tabs.push(...tabs)
  }
  if (tree) visit(tree)
  return { groups, missing: Math.max(0, slots - groups.length) }
}

export const singleGroup = (id: string): TileGroup => ({ active: id, tabs: [id] })

const pane = (group: TileGroup): ChatLayout => group.tabs.length > 1
  ? { kind: 'pane', id: group.active, tabs: group.tabs } : { kind: 'pane', id: group.active }

/** Equal tiles along one axis, with ratios that account for the dividers between them. */
function strip(nodes: ChatLayout[], axis: 'horizontal' | 'vertical', extent: number, newId: () => string): ChatLayout {
  if (nodes.length === 1) return nodes[0]!
  const tile = (extent - (nodes.length - 1) * DIVIDER_SIZE) / nodes.length
  const rest = extent - tile - DIVIDER_SIZE
  return { kind: 'split', id: newId(), axis, ratio: clampRatio(tile / (extent - DIVIDER_SIZE)),
    first: nodes[0]!, second: strip(nodes.slice(1), axis, rest, newId) }
}

const clampRatio = (ratio: number): number => Math.max(0.05, Math.min(0.95, Number.isFinite(ratio) ? ratio : 0.5))

/** Rows of equal tiles; a short last row spreads its tiles across the full width. Browser excluded. */
export function gridLayout(groups: readonly TileGroup[], size: CanvasSize, newId: () => string): ChatLayout {
  const grid = chooseGrid(groups.length, size) ?? { cols: Math.ceil(Math.sqrt(groups.length)), rows: 0, tileWidth: 0, tileHeight: 0 }
  const rows: ChatLayout[] = []
  for (let start = 0; start < groups.length; start += grid.cols) {
    rows.push(strip(groups.slice(start, start + grid.cols).map(pane), 'horizontal', size.width, newId))
  }
  return strip(rows, 'vertical', size.height, newId)
}

/** Browser column in the middle, two stacked chats on each side; expects exactly four groups. */
export function browserCentreLayout(groups: readonly TileGroup[], size: CanvasSize, newId: () => string): ChatLayout {
  const [a, b, c, d] = groups.map(pane) as [ChatLayout, ChatLayout, ChatLayout, ChatLayout]
  const browserWidth = Math.round(size.width * BROWSER_CENTRE_RATIO)
  const columnWidth = (size.width - browserWidth - 2 * DIVIDER_SIZE) / 2
  const column = (top: ChatLayout, bottom: ChatLayout): ChatLayout => strip([top, bottom], 'vertical', size.height, newId)
  const right: ChatLayout = { kind: 'split', id: newId(), axis: 'horizontal',
    ratio: clampRatio(browserWidth / (size.width - columnWidth - 2 * DIVIDER_SIZE)),
    first: { kind: 'pane', id: BROWSER_PANE_ID }, second: column(c, d) }
  return { kind: 'split', id: newId(), axis: 'horizontal', ratio: clampRatio(columnWidth / (size.width - DIVIDER_SIZE)),
    first: column(a, b), second: right }
}

/** A single chat beside the browser; expects exactly one group. */
export function browserSideLayout(groups: TileGroup[], newId: () => string): ChatLayout {
  const [a] = groups.map(pane) as [ChatLayout]
  return { kind: 'split', id: newId(), axis: 'horizontal', ratio: clampRatio(BROWSER_SIDE_RATIO),
    first: a, second: { kind: 'pane', id: BROWSER_PANE_ID } }
}

/** A chat on each side of the browser, the browser as wide as in the centre preset; expects exactly two groups. */
export function browserBetweenLayout(groups: readonly TileGroup[], size: CanvasSize, newId: () => string): ChatLayout {
  const [a, b] = groups.map(pane) as [ChatLayout, ChatLayout]
  const browserWidth = Math.round(size.width * BROWSER_CENTRE_RATIO)
  const sideWidth = (size.width - browserWidth - 2 * DIVIDER_SIZE) / 2
  const right: ChatLayout = { kind: 'split', id: newId(), axis: 'horizontal',
    ratio: clampRatio(browserWidth / (size.width - sideWidth - 2 * DIVIDER_SIZE)),
    first: { kind: 'pane', id: BROWSER_PANE_ID }, second: b }
  return { kind: 'split', id: newId(), axis: 'horizontal', ratio: clampRatio(sideWidth / (size.width - DIVIDER_SIZE)),
    first: a, second: right }
}

/** The tree a preset produces for the given groups, before any chats are created. */
export function presetLayout(preset: LayoutPreset, groups: TileGroup[], size: CanvasSize, newId: () => string): ChatLayout {
  if (preset.kind === 'grid') return gridLayout(groups, size, newId)
  if (preset.kind === 'browser-side') return browserSideLayout(groups, newId)
  if (preset.kind === 'browser-between') return browserBetweenLayout(groups, size, newId)
  return browserCentreLayout(groups, size, newId)
}

export const presetSlots = (preset: LayoutPreset): number =>
  preset.kind === 'grid' ? preset.count : preset.kind === 'browser-side' ? BROWSER_SIDE_SLOTS
    : preset.kind === 'browser-between' ? BROWSER_BETWEEN_SLOTS : BROWSER_CENTRE_SLOTS

/**
 * One-click starting layouts exposed in View. Every open window and tab lands in one of the
 * preset's windows (the extra ones join the last), floating and minimized ones included.
 */
export const QUICK_LAYOUT_PRESETS: Array<{ key: string; label: string; preset: LayoutPreset }> = [
  { key: 'browser-side', label: 'Chats left, browser right (full workspace)', preset: { kind: 'browser-side' } },
  { key: 'browser-between', label: 'Chat, browser, chat (full workspace)', preset: { kind: 'browser-between' } },
  { key: 'browser-centre', label: 'Browser centre (full workspace)', preset: { kind: 'browser-centre' } },
  { key: 'six', label: '6 chats', preset: { kind: 'grid', count: 6 } },
  { key: 'four', label: '4 chats', preset: { kind: 'grid', count: 4 } }
]
