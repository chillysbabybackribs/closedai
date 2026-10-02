import type { AppIconId } from '../app-icons.js'

// The dock's rules, kept apart from React so they are testable: its saved settings, when the
// pointer shows or hides it, what each tray entry says, and the "where you are" line.

export type DockPrefs = {
  /** Surfaces hidden from the footer until pinned again in dock settings. */
  hiddenTray: TrayAppId[]
  /** Launchers the user pinned back onto the footer rail, in tray order. */
  pinnedTray: TrayAppId[]
  /** Workspace, Library and Settings shortcuts; an empty list is intentional. */
  pinnedControls: DockControlId[]
}

export type DockControlId = Extract<AppIconId, 'workspaces' | 'library' | 'settings'>
export type DockIconId = DockControlId | Exclude<TrayAppId, 'saved-sites' | 'downloads'>
const DOCK_CONTROL_ORDER: readonly DockControlId[] = ['workspaces', 'library', 'settings']
export const DOCK_ICON_OPTIONS: readonly { id: DockIconId; label: string }[] = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'chats', label: 'Chats' },
  { id: 'browser', label: 'Browser' },
  { id: 'video', label: 'Video' },
  { id: 'files', label: 'Files' },
  { id: 'note', label: 'Notes' },
  { id: 'agents', label: 'Agents' },
  { id: 'library', label: 'Library' },
  { id: 'settings', label: 'Settings' }
]

export const DEFAULT_DOCK_PREFS: DockPrefs = {
  hiddenTray: [], pinnedTray: ['chats', 'browser', 'video', 'files', 'note'],
  pinnedControls: [...DOCK_CONTROL_ORDER]
}
const PREFS_KEY = 'closedai.dock.v1'

function normalizeTrayList<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(value)) return []
  const allow = new Set<T>(allowed)
  const seen = new Set<T>()
  const out: T[] = []
  for (const id of value) {
    if (typeof id !== 'string' || !allow.has(id as T)) continue
    const trayId = id as T
    if (seen.has(trayId)) continue
    seen.add(trayId)
    out.push(trayId)
  }
  return out
}

export function readDockPrefs(storage: Pick<Storage, 'getItem'>): DockPrefs {
  try {
    const value = JSON.parse(storage.getItem(PREFS_KEY) ?? 'null') as (Partial<DockPrefs> & { railVersion?: number }) | null
    return {
      hiddenTray: normalizeTrayList(value?.hiddenTray, TRAY_APP_ORDER),
      pinnedControls: Array.isArray(value?.pinnedControls)
        ? normalizeTrayList(value.pinnedControls, DOCK_CONTROL_ORDER)
        : [...DEFAULT_DOCK_PREFS.pinnedControls],
      pinnedTray: (value?.railVersion ?? 0) >= 2
        ? normalizeTrayList(value?.railVersion === 2 && Array.isArray(value.pinnedTray) && value.pinnedTray.length
          ? [...value.pinnedTray, 'files'] : value?.pinnedTray, PINNABLE_TRAY)
        : [...new Set([...DEFAULT_DOCK_PREFS.pinnedTray, ...normalizeTrayList(value?.pinnedTray, PINNABLE_TRAY)])]
    }
  } catch {
    return DEFAULT_DOCK_PREFS
  }
}

export function saveDockPrefs(storage: Pick<Storage, 'setItem'>, prefs: DockPrefs): void {
  try { storage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, railVersion: 3 })) } catch { /* private mode or full: the defaults return */ }
}

/** Floating dock band: 68 px targets in an 82 px wrapper, with 7 px above and below. */
export const DOCK_HEIGHT = 96
/** Pointer-hit and hide band for the auto-revealing footer. */
export const DOCK_REST = DOCK_HEIGHT
export const DOCK_REACH = DOCK_HEIGHT + 4
/** The entire dock-height band at the bottom of the window reveals the dock. */
export const REVEAL_EDGE = DOCK_HEIGHT
/** Above this the pointer has left the dock, so a shown dock starts its hide delay. */
export const HOLD_BAND = DOCK_REACH + 16
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

export type TrayAppId = Extract<AppIconId, 'chats' | 'browser' | 'video' | 'files' | 'note' | 'agents' | 'saved-sites' | 'downloads'>

/** Footer tray order; new surfaces append here. */
const TRAY_APP_ORDER: readonly TrayAppId[] = ['chats', 'browser', 'video', 'files', 'note', 'agents', 'saved-sites', 'downloads']

/** Launchers that can be pinned straight onto the footer rail. Stacks (Saved, Downloads) are not. */
const PINNABLE_TRAY: readonly TrayAppId[] = ['chats', 'browser', 'video', 'files', 'note', 'agents']

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
  videoActive?: boolean
  filesVisible?: boolean
  agentRuns: number
  runningAgentRuns: number
  agentSummary: string
  savedSites: number
  notes: number
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
      note: input.browserVisible ? 'Hide browser' : 'Show browser' },
    { id: 'video', label: 'Video', stack: false, active: input.videoActive ?? false,
      note: input.videoActive ? 'Video library open' : 'Open video library' },
    { id: 'files', label: 'Files', stack: false, active: input.filesVisible ?? false,
      note: input.filesVisible ? 'Hide files' : 'Show working directory files' },
    { id: 'note', label: 'Notes', stack: false, active: false,
      note: input.notes > 0 ? `${count(input.notes, 'note')} · open the notepad` : 'Start a note' },
    { id: 'agents', label: 'Agents', stack: false, active: input.runningAgentRuns > 0,
      note: input.agentRuns > 0 ? input.agentSummary : 'No runs · open Agents' },
    { id: 'saved-sites', label: 'Saved', stack: true, active: false,
      note: input.savedSites > 0 ? count(input.savedSites, 'site') : 'None yet' },
    { id: 'downloads', label: 'Downloads', stack: true, active: input.activeDownloads > 0,
      note: input.activeDownloads > 0 ? `${input.activeDownloads} downloading`
        : input.downloads > 0 ? count(input.downloads, 'file') : 'None yet' }
  ]
}

export function canPinTrayApp(id: TrayAppId): boolean {
  return PINNABLE_TRAY.includes(id)
}

export function isTrayAppPinned(id: TrayAppId, pinnedTray: readonly TrayAppId[]): boolean {
  return pinnedTray.includes(id)
}

export function setTrayAppPinned(pinnedTray: readonly TrayAppId[], id: TrayAppId, pinned: boolean): TrayAppId[] {
  if (pinned && !canPinTrayApp(id)) return [...pinnedTray]
  const next = new Set(pinnedTray)
  if (pinned) next.add(id)
  else next.delete(id)
  return PINNABLE_TRAY.filter((candidate) => next.has(candidate))
}

/** The launchers pinned to the footer rail, in tray order. */
export function pinnedTrayApps(input: TrayInput, pinnedTray: readonly TrayAppId[]): TrayApp[] {
  const pinned = new Set(pinnedTray)
  return trayApps(input).filter((app) => canPinTrayApp(app.id) && pinned.has(app.id))
}

function isDockControl(id: DockIconId): id is DockControlId {
  return DOCK_CONTROL_ORDER.includes(id as DockControlId)
}

export function isDockIconPinned(prefs: DockPrefs, id: DockIconId): boolean {
  return isDockControl(id) ? prefs.pinnedControls.includes(id) : prefs.pinnedTray.includes(id)
}

/** Change only this shortcut's pins; unpinning never closes its window or changes provider usage. */
export function dockIconPinPatch(prefs: DockPrefs, id: DockIconId, pinned: boolean): Partial<DockPrefs> {
  if (!isDockControl(id)) return { pinnedTray: setTrayAppPinned(prefs.pinnedTray, id, pinned) }
  const next = new Set(prefs.pinnedControls)
  if (pinned) next.add(id)
  else next.delete(id)
  return { pinnedControls: DOCK_CONTROL_ORDER.filter((candidate) => next.has(candidate)) }
}

/** "Where you are": the workspace and the selected chat, or the overview itself. */
export function dockLocation(input: { overview: boolean; space: string; chat: string | null }): string[] {
  if (input.overview) return ['All workspaces']
  return input.chat ? [input.space, input.chat] : [input.space]
}

/** Breadcrumb text for tooltips and screen readers. */
export function dockLocationLabel(parts: readonly string[]): string {
  return parts.join(' › ')
}
