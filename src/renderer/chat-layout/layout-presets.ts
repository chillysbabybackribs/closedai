import { BROWSER_PANE_ID, DIVIDER_SIZE, type ChatLayout } from './layout-tree.js'

export type LayoutPreset = { kind: 'browser-centre' } | { kind: 'grid'; count: number } | { kind: 'browser-side' }
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
export function gridLayout(groups: TileGroup[], size: CanvasSize, newId: () => string): ChatLayout {
  const grid = chooseGrid(groups.length, size) ?? { cols: Math.ceil(Math.sqrt(groups.length)), rows: 0, tileWidth: 0, tileHeight: 0 }
  const rows: ChatLayout[] = []
  for (let start = 0; start < groups.length; start += grid.cols) {
    rows.push(strip(groups.slice(start, start + grid.cols).map(pane), 'horizontal', size.width, newId))
  }
  return strip(rows, 'vertical', size.height, newId)
}

/** Browser column in the middle, two stacked chats on each side; expects exactly four groups. */
export function browserCentreLayout(groups: TileGroup[], size: CanvasSize, newId: () => string): ChatLayout {
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

/** The tree a preset produces for the given groups, before any chats are created. */
export function presetLayout(preset: LayoutPreset, groups: TileGroup[], size: CanvasSize, newId: () => string): ChatLayout {
  if (preset.kind === 'grid') return gridLayout(groups, size, newId)
  if (preset.kind === 'browser-side') return browserSideLayout(groups, newId)
  return browserCentreLayout(groups, size, newId)
}

export const presetSlots = (preset: LayoutPreset): number =>
  preset.kind === 'grid' ? preset.count : preset.kind === 'browser-side' ? BROWSER_SIDE_SLOTS : BROWSER_CENTRE_SLOTS
