import { BROWSER_PANE_ID, type ChatLayout, type Rect } from '../layout-tree.js'
import { clampWindow, windowMinimum, windowPanes, type WindowSize } from './window-layout.js'
import type { WindowTile } from './window-targets.js'

/** A window as the canvas draws it. Hidden windows (minimized, or the hidden browser) stay mounted. */
export type CanvasTile = { id: string; tabs: string[]; rect: Rect; kind: 'tiled' | 'floating' | 'hidden'; z: number }

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
    if (placed) return { ...placed, kind: 'tiled', z: 0 }
    const shown = pane.float && !pane.docked && (pane.id !== BROWSER_PANE_ID || browserVisible)
    return shown
      ? { id: pane.id, tabs, rect: clampWindow(pane.float!, size, windowMinimum(pane.id)), kind: 'floating', z: pane.float!.z }
      : { id: pane.id, tabs, rect: NOWHERE, kind: 'hidden', z: 0 }
  })
  const known = new Set(panes.map((pane) => pane.id))
  return [...tiles, ...tiled.filter((tile) => !known.has(tile.id)).map((tile): CanvasTile => ({ ...tile, kind: 'tiled', z: 0 }))]
}

/** Floating windows front to back: the order a pointer meets them. */
export function floatingFront(tiles: readonly CanvasTile[]): WindowTile[] {
  return tiles.filter((tile) => tile.kind === 'floating').sort((a, b) => b.z - a.z).map(({ id, rect }) => ({ id, rect }))
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

/**
 * Whether a window stacked above the browser overlaps it. The native page paints over every DOM
 * window, so while one is above it the browser shows its still instead.
 */
export function browserCovered(tiles: readonly CanvasTile[]): boolean {
  const browser = tiles.find((tile) => tile.id === BROWSER_PANE_ID && tile.kind !== 'hidden')
  if (!browser) return false
  return tiles.some((tile) => tile.kind === 'floating' && tile.id !== BROWSER_PANE_ID && tile.z > browser.z && overlaps(tile.rect, browser.rect))
}
