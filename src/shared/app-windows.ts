// Contracts for the app's windows: the main window owns the browser and the menus, and detached
// windows each hold their own tab layout for chats the user moved out of it. A chat lives in one
// window at a time; closing a detached window hands its chats back to the main window.

import type { AppWindowDockEvent, CrossWindowDockComplete, CrossWindowDockRouteRequest, CrossWindowDockRouteResult } from './cross-window-dock.js'
import type { QuickChatOverlayRequest } from './quick-chat-overlay.js'

export type AppWindowId = string

export const MAIN_WINDOW_ID: AppWindowId = 'main'

/** Who this renderer is. A detached window keeps the project it was opened for. */
export type AppWindowContext = {
  id: AppWindowId
  main: boolean
  /** The project a detached window belongs to; null for the main window, which follows the workspace. */
  cwd: string | null
  /** Tabs a detached window opens with when it has no saved layout of its own yet. */
  initialTabs: string[]
}

/** One open window and the chat tabs it last reported. */
export type AppWindowInfo = {
  id: AppWindowId
  main: boolean
  cwd: string | null
  focused: boolean
  tabIds: string[]
}

/** Requests main relays from one window to another. */
export type AppWindowCommand =
  /** Bring a tab this window holds to the front; sent when another window tried to open it. */
  | { type: 'activateTab'; tabId: string }
  /** Take these chats as tabs; sent to the main window when a detached window closes. */
  | { type: 'adoptTabs'; tabIds: string[] }
  /** Show the browser; sent to the main window from a detached window's Browser control. */
  | { type: 'showBrowser' }
  /** Open, renew or close the browser's quick chat; sent to the main window from the quick chat layer. */
  | { type: 'quickChat'; request: QuickChatOverlayRequest }
  /** Remove a pane another window absorbed; close this window when the layout empties. */
  | { type: 'removeCrossDockSource'; paneId: string; tabIds: string[] }
  /** Merge chats dropped from another window using the agreed target zones. */
  | { type: 'absorbCrossDock'; paneId: string; tabIds: string[]; pointer: { x: number; y: number } }

export type AppWindowsEvent =
  | { type: 'windows'; windows: AppWindowInfo[] }
  | { type: 'command'; command: AppWindowCommand }
  | { type: 'dock'; dock: AppWindowDockEvent }

export type { CrossWindowDockComplete, CrossWindowDockRouteRequest, CrossWindowDockRouteResult }

/** A box in a window's page, in CSS pixels; main converts it to the window's own coordinates. */
export type AppWindowRegion = { x: number; y: number; width: number; height: number }

/** Query parameter a detached window's renderer is loaded with. */
export const APP_WINDOW_QUERY = 'window'
