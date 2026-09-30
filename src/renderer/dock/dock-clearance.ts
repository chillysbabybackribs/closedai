import { createContext } from 'react'
import { REVEAL_EDGE } from './dock-model.js'

/**
 * How far above the canvas floor a browser window must stop while the dock is pinned, or 0. The
 * native page paints over anything the renderer draws, so it keeps clear of the strip and the
 * resting tiles; chats, notes and views are DOM and simply run under the dock.
 */
export const DockClearanceContext = createContext(0)

/** The dock's reserve less the workspace's own bottom padding, which is already clear of it. */
export function dockClearance(reserve: number): number {
  return Math.max(0, reserve - REVEAL_EDGE)
}

/** How much of a browser window's bottom edge falls inside the dock's clearance band. */
export function browserDockInset(rect: { y: number; height: number }, canvasHeight: number, clearance: number): number {
  if (clearance <= 0) return 0
  const overlap = rect.y + rect.height - (canvasHeight - clearance)
  return Math.min(Math.max(0, overlap), rect.height)
}
