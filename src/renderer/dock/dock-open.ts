import { createContext } from 'react'

/**
 * Whether the auto-revealing dock is showing. It floats over the workspace, so a native browser
 * page that reaches into its band gives way to its still while the dock is open.
 */
export const DockOpenContext = createContext(false)
