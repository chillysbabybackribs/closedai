import type { AppIconId } from '../app-icons.js'

// The dock's rules, kept apart from React so they are testable: its saved settings, when the
// pointer shows or hides it, what each tray entry says, and the "where you are" line.

export type DockPrefs = {
  /** Keep the dock on screen and give it its own row under the workspace. */
  keepVisible: boolean
  /** Grow tray icons under the pointer. */
  magnify: boolean
}

export const DEFAULT_DOCK_PREFS: DockPrefs = { keepVisible: false, magnify: true }
const PREFS_KEY = 'closedai.dock.v1'

export function readDockPrefs(storage: Pick<Storage, 'getItem'>): DockPrefs {
  try {
    const value = JSON.parse(storage.getItem(PREFS_KEY) ?? 'null') as Partial<DockPrefs> | null
    return {
      keepVisible: typeof value?.keepVisible === 'boolean' ? value.keepVisible : DEFAULT_DOCK_PREFS.keepVisible,
      magnify: typeof value?.magnify === 'boolean' ? value.magnify : DEFAULT_DOCK_PREFS.magnify
    }
  } catch {
    return DEFAULT_DOCK_PREFS
  }
}

export function saveDockPrefs(storage: Pick<Storage, 'setItem'>, prefs: DockPrefs): void {
  try { storage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* private mode or full: the defaults return */ }
}

/** Height of the strip along the bottom of the window. */
export const DOCK_HEIGHT = 48
/** Tray icon size at rest and under the pointer (about 1.4x while the tray is short). */
export const TRAY_ICON = 36
export const TRAY_MAGNIFIED = 50
/**
 * With Keep visible on, the workspace ends this far above the window's bottom edge. The gap past
 * the strip keeps the browser's edge margin (titlebar-browser-freeze.ts) clear of the dock, so a
 * dock that is always shown never turns the page into a still.
 */
export const DOCK_RESERVE = DOCK_HEIGHT + 6
/** The workspace's own bottom padding: a renderer strip no native browser view ever covers. */
export const REVEAL_EDGE = 10
/** Above this the pointer has left the dock, so a shown dock starts its hide delay. */
export const HOLD_BAND = DOCK_HEIGHT + 24
export const HIDE_DELAY_MS = 380

/**
 * What the pointer at `y` (window pixels, `height` tall) asks of an auto-hiding dock: `show` at the
 * bottom edge, `hold` near a shown dock, `leave` anywhere else.
 */
export function pointerReveal(y: number, height: number, shown: boolean): 'show' | 'hold' | 'leave' {
  if (y >= height - REVEAL_EDGE) return 'show'
  if (shown && y >= height - HOLD_BAND) return 'hold'
  return 'leave'
}

export type TrayAppId = Extract<AppIconId, 'chats' | 'browser' | 'agents' | 'saved-sites' | 'downloads'>

export type TrayApp = {
  id: TrayAppId
  label: string
  /** The tooltip's second line: what is in it now. */
  note: string
  /** Something in it is running or showing: the dot under the icon. */
  active: boolean
  /** Opens a list above the icon rather than going somewhere. */
  stack: boolean
}

export type TrayInput = {
  runningChats: number
  browserVisible: boolean
  agentRuns: number
  runningAgentRuns: number
  agentSummary: string
  savedSites: number
  downloads: number
  activeDownloads: number
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** ClosedAI's own surfaces, in tray order. Each new feature adds one entry here. */
export function trayApps(input: TrayInput): TrayApp[] {
  return [
    { id: 'chats', label: 'Chats', stack: false, active: input.runningChats > 0,
      note: input.runningChats > 0 ? `${input.runningChats} running · open chat history` : 'Open chat history' },
    { id: 'browser', label: 'Browser', stack: false, active: input.browserVisible,
      note: input.browserVisible ? 'Showing · click to hide' : 'Hidden · click to show' },
    { id: 'agents', label: 'Agent runs', stack: false, active: input.runningAgentRuns > 0,
      note: input.agentRuns > 0 ? input.agentSummary : 'No runs · open Agents' },
    { id: 'saved-sites', label: 'Saved sites', stack: true, active: false,
      note: input.savedSites > 0 ? count(input.savedSites, 'site') : 'None yet' },
    { id: 'downloads', label: 'Downloads', stack: true, active: input.activeDownloads > 0,
      note: input.activeDownloads > 0 ? `${input.activeDownloads} downloading`
        : input.downloads > 0 ? count(input.downloads, 'file') : 'None yet' }
  ]
}

/** "Where you are": the workspace and the selected chat, or the overview itself. */
export function dockLocation(input: { overview: boolean; space: string; chat: string | null }): string[] {
  if (input.overview) return ['All workspaces']
  return input.chat ? [input.space, input.chat] : [input.space]
}
