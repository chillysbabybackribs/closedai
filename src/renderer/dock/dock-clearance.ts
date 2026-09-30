import { createContext } from 'react'
import { REVEAL_EDGE } from './dock-model.js'

/**
 * How far the workspace stops above its floor while the dock is pinned, or 0. The viewport pads
 * its bottom by this, so every tile (the native browser page included) ends above the resting tiles.
 */
export const DockClearanceContext = createContext(0)

/** The dock's reserve less the workspace's own bottom padding, which is already clear of it. */
export function dockClearance(reserve: number): number {
  return Math.max(0, reserve - REVEAL_EDGE)
}
