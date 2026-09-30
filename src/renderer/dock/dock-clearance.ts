import { createContext } from 'react'

/**
 * The bottom padding, in px, the workspace keeps while the dock is pinned, or 0: the rail's height.
 * Every tile (the native browser page included) ends above the rail; the icons standing above it
 * overlay whatever is under them.
 */
export const DockClearanceContext = createContext(0)
