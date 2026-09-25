import { BROWSER_PANE_ID, type ChatLayout, type Rect } from '../layout-tree.js'
import { clampWindow, windowMinimum, windowPanes, type WindowSize } from './window-layout.js'
import type { WindowTile } from './window-targets.js'

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

/**
 * A window as the canvas draws it. Hidden windows (minimized, or the hidden browser) stay mounted.
 * `z` stacks it: 0 for the tiled layer, above that floating windows, and windows kept on top above
 * every other (a tiled one too, so nothing floating covers it).
 */
export type CanvasTile = { id: string; tabs: string[]; rect: Rect; kind: 'tiled' | 'floating' | 'hidden'; z: number }

/** Added to the stack place of a window kept on top. */
export const ON_TOP = 1000

const NOWHERE: Rect = { x: 0, y: 0, width: 0, height: 0 }

/**
 * Every window in tree order, so a window changing layer never moves its DOM node (which would
 * reset transcript scroll). `tiled` is the tiled layer's geometry, including tiles a drag preview
 * adds; those follow the tree's windows.
 */
export function canvasTiles(tree: ChatLayout, tiled: ReadonlyArray<{ id: string; tabs: string[]; rect: Rect }>,
  size: WindowSize, browserVisible: boolean): CanvasTile[] {
  const byId = new Map(tiled.map((tile) => [tile.id, tile]))
  const panes = windowPanes(tree)
  const tiles = panes.map((pane): CanvasTile => {
    const tabs = pane.tabs ?? [pane.id]
    const placed = byId.get(pane.id)
    const top = pane.onTop ? ON_TOP : 0
    if (placed) return { ...placed, kind: 'tiled', z: top }
    const shown = pane.float && !pane.docked && (pane.id !== BROWSER_PANE_ID || browserVisible)
    return shown
      ? { id: pane.id, tabs, rect: clampWindow(pane.float!, size, windowMinimum(pane.id)), kind: 'floating', z: top + pane.float!.z }
      : { id: pane.id, tabs, rect: NOWHERE, kind: 'hidden', z: 0 }
  })
  const known = new Set(panes.map((pane) => pane.id))
  return yieldBrowser([...tiles, ...tiled.filter((tile) => !known.has(tile.id)).map((tile): CanvasTile => ({ ...tile, kind: 'tiled', z: 0 }))])
}

/** The largest part of `rect` that `cover` leaves showing, when one is at least `minimum`; else null. */
export function uncoveredRect(rect: Rect, cover: Rect, minimum: WindowSize): Rect | null {
  if (!overlaps(rect, cover)) return rect
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const parts: Rect[] = [
    { ...rect, width: cover.x - rect.x },
    { ...rect, x: cover.x + cover.width, width: right - (cover.x + cover.width) },
    { ...rect, height: cover.y - rect.y },
    { ...rect, y: cover.y + cover.height, height: bottom - (cover.y + cover.height) }
  ].filter((part) => part.width >= minimum.width && part.height >= minimum.height)
  return parts.reduce<Rect | null>((best, part) => !best || part.width * part.height > best.width * best.height ? part : best, null)
}

/**
 * The browser's page is a native view painted over every DOM window, so it cannot stay live under
 * a window kept on top. It gives way instead, taking the largest part of its rect that window
 * leaves showing; with no part big enough it keeps its rect and browserCovered shows its still.
 */
function yieldBrowser(tiles: CanvasTile[]): CanvasTile[] {
  const browser = tiles.find((tile) => tile.id === BROWSER_PANE_ID && tile.kind !== 'hidden')
  if (!browser) return tiles
  const minimum = windowMinimum(BROWSER_PANE_ID)
  let rect = browser.rect
  for (const tile of tiles) {
    if (tile.kind !== 'hidden' && tile.z >= ON_TOP && tile.z > browser.z) rect = uncoveredRect(rect, tile.rect, minimum) ?? rect
  }
  return rect === browser.rect ? tiles : tiles.map((tile) => tile === browser ? { ...tile, rect } : tile)
}

/** Floating windows front to back: the order a pointer meets them. */
export function floatingFront(tiles: readonly CanvasTile[]): WindowTile[] {
  return tiles.filter((tile) => tile.kind === 'floating').sort((a, b) => b.z - a.z).map(({ id, rect }) => ({ id, rect }))
}

/**
 * Whether a window stacked above the browser overlaps it. The native page paints over every DOM
 * window, so while one is above it the browser shows its still instead.
 */
export function browserCovered(tiles: readonly CanvasTile[]): boolean {
  const browser = tiles.find((tile) => tile.id === BROWSER_PANE_ID && tile.kind !== 'hidden')
  if (!browser) return false
  return tiles.some((tile) => tile.kind !== 'hidden' && tile.id !== BROWSER_PANE_ID && tile.z > browser.z && overlaps(tile.rect, browser.rect))
}
