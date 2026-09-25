import { randomUUID } from 'node:crypto'
import type { BrowserWindow, Rectangle, WebContents } from 'electron'
import { MAIN_WINDOW_ID, type AppWindowCommand, type AppWindowContext, type AppWindowId, type AppWindowInfo } from '../../shared/app-windows.js'
import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import { IPC, type IpcEventChannel, type IpcEventChannels } from '../../shared/ipc-channels.js'
import type { AppWindowStore } from './app-window-store.js'

// Every app-shell window, and the one place main decides which of them hears what. The main
// window owns the browser, so browser state goes only there; chat streams go to the window
// showing that chat; everything else is workspace-wide and reaches every window. A detached
// window holds chats the user moved out of the main window; closing it hands them back, while
// quitting or switching projects keeps it so it reopens with its chats.

export type RegistryWindow = Pick<BrowserWindow,
  'isDestroyed' | 'close' | 'show' | 'focus' | 'isMinimized' | 'restore' | 'isFocused' | 'isMaximized' | 'getBounds' | 'on'
> & { webContents: Pick<WebContents, 'id' | 'isDestroyed' | 'send'> }

export type AppWindowRegistryDeps = {
  store: AppWindowStore
  /** Create and start loading a detached window's renderer. */
  openWindow: (id: AppWindowId) => RegistryWindow
  /** Drop the placement Electron persisted for a window the user closed for good. */
  forgetPlacement: (id: AppWindowId) => void
  /** Stop counting a closed window's chats as visible. */
  releaseChats: (id: AppWindowId) => void
  workspaceCwd: () => string
  display?: (bounds: Rectangle) => { id: number; label: string } | null
}

/** A window as the app-state tool reports it. */
export type AppWindowDescription = AppWindowInfo & {
  maximized: boolean
  bounds: Rectangle
  display: { id: number; label: string } | null
}

type Entry = {
  id: AppWindowId
  main: boolean
  cwd: string | null
  window: RegistryWindow
  visible: Set<string>
  tabIds: string[]
  initialTabs: string[]
  /** Closing keeps the record (quit, project switch) instead of handing the chats back. */
  keep: boolean
}

// Browser chrome renders only where the browser lives.
const MAIN_ONLY_CHANNELS = new Set<IpcEventChannel>([
  IPC.event.browserState, IPC.event.browserTabs, IPC.event.browserDownloadsChanged
])

export class AppWindowRegistry {
  private readonly entries = new Map<AppWindowId, Entry>()
  private shuttingDown = false
  private observedCwd: string | null = null

  constructor(private readonly deps: AppWindowRegistryDeps) {}

  attachMain(window: RegistryWindow): void {
    const entry = this.track(MAIN_WINDOW_ID, true, null, window, [])
    // The app is its main window: closing it quits, and detached windows reopen next launch.
    window.on('closed', () => {
      this.shutdown()
      for (const other of this.entries.values()) if (other !== entry && !other.window.isDestroyed()) other.window.close()
    })
  }

  /** Reopen the saved detached windows of this project that are not already open. */
  restore(cwd: string): void {
    this.observedCwd = cwd
    for (const record of this.deps.store.list()) {
      if (record.cwd !== cwd || this.entries.has(record.id)) continue
      this.open(record.id, record.cwd, record.tabIds)
    }
  }

  /** Called with every workspace snapshot; a project change swaps the detached windows shown. */
  observeWorkspace(cwd: string): void {
    if (this.shuttingDown || cwd === this.observedCwd) return
    for (const entry of this.entries.values()) {
      if (entry.main || entry.cwd === cwd) continue
      entry.keep = true
      entry.window.close()
    }
    this.restore(cwd)
  }

  shutdown(): void {
    this.shuttingDown = true
  }

  idOf(contents: Pick<WebContents, 'id'>): AppWindowId | null {
    for (const entry of this.entries.values()) {
      if (!entry.window.isDestroyed() && entry.window.webContents.id === contents.id) return entry.id
    }
    return null
  }

  context(contents: Pick<WebContents, 'id'>): AppWindowContext {
    const entry = this.require(contents)
    return { id: entry.id, main: entry.main, cwd: entry.cwd, initialTabs: [...entry.initialTabs] }
  }

  list(): AppWindowInfo[] {
    return [...this.entries.values()].filter((entry) => !entry.window.isDestroyed()).map((entry) => ({
      id: entry.id, main: entry.main, cwd: entry.cwd, focused: entry.window.isFocused(), tabIds: [...entry.tabIds]
    }))
  }

  describe(): AppWindowDescription[] {
    return this.list().map((info) => {
      const window = this.entries.get(info.id)!.window
      const bounds = window.getBounds()
      return { ...info, maximized: window.isMaximized(), bounds, display: this.deps.display?.(bounds) ?? null }
    })
  }

  isMain(contents: Pick<WebContents, 'id'>): boolean {
    return this.idOf(contents) === MAIN_WINDOW_ID
  }

  /** A window's tiles changed: remember what it shows (for routing) and holds (for ownership). */
  claim(windowId: AppWindowId, visible: string[], tabs: string[]): void {
    const entry = this.entries.get(windowId)
    if (!entry) return
    entry.visible = new Set(visible)
    const tabIds = [...new Set([...tabs, ...visible])]
    if (tabIds.join('\0') === entry.tabIds.join('\0')) return
    entry.tabIds = tabIds
    if (!entry.main && entry.cwd) this.deps.store.put({ id: entry.id, cwd: entry.cwd, tabIds })
    this.broadcastWindows()
  }

  /** Move tabs out of the sender's window into a new one for the current project. */
  detach(source: Pick<WebContents, 'id'>, cwd: string, tabIds: string[]): AppWindowId {
    const from = this.require(source)
    if (cwd !== this.deps.workspaceCwd()) throw new Error('The project changed before the tab could move')
    const tabs = [...new Set(tabIds)]
    if (!tabs.length || tabs.some((id) => typeof id !== 'string' || !id)) throw new Error('Choose a tab to move')
    from.tabIds = from.tabIds.filter((id) => !tabs.includes(id))
    for (const id of tabs) from.visible.delete(id)
    const id = randomUUID()
    this.deps.store.put({ id, cwd, tabIds: tabs })
    this.open(id, cwd, tabs)
    return id
  }

  /** Hand tabs from the sender's detached window back to the main window. */
  returnTabs(source: Pick<WebContents, 'id'>, tabIds: string[]): void {
    const from = this.require(source)
    const main = this.entries.get(MAIN_WINDOW_ID)
    if (from.main || !main) return
    const tabs = tabIds.filter((id) => typeof id === 'string' && id)
    from.tabIds = from.tabIds.filter((id) => !tabs.includes(id))
    for (const id of tabs) from.visible.delete(id)
    if (from.cwd) this.deps.store.put({ id: from.id, cwd: from.cwd, tabIds: from.tabIds })
    this.command(main, { type: 'adoptTabs', tabIds: tabs })
    this.raise(main)
    this.broadcastWindows()
  }

  /** Bring the other window holding this tab forward; false when no other window holds it. */
  revealTab(source: Pick<WebContents, 'id'>, tabId: string): boolean {
    const from = this.idOf(source)
    const owner = [...this.entries.values()].find((entry) => entry.id !== from && entry.tabIds.includes(tabId))
    if (!owner || owner.window.isDestroyed()) return false
    this.raise(owner)
    this.command(owner, { type: 'activateTab', tabId })
    return true
  }

  showBrowser(): void {
    const main = this.entries.get(MAIN_WINDOW_ID)
    if (!main) return
    this.raise(main)
    this.command(main, { type: 'showBrowser' })
  }

  send<C extends IpcEventChannel>(channel: C, payload: IpcEventChannels[C]): void {
    const mainOnly = MAIN_ONLY_CHANNELS.has(channel)
    for (const entry of this.entries.values()) if (entry.main || !mainOnly) deliver(entry, channel, payload)
  }

  /** Transcript traffic goes to the window showing the chat; the main window hears the rest. */
  sendChatEvent(event: ChatWorkspaceEvent): void {
    if (event.type !== 'pane') {
      this.send(IPC.event.chatEvent, event)
      return
    }
    const showing = [...this.entries.values()].filter((entry) => entry.visible.has(event.paneId))
    const targets = showing.length ? showing : [this.entries.get(MAIN_WINDOW_ID)].filter((entry) => !!entry)
    for (const entry of targets) deliver(entry, IPC.event.chatEvent, event)
  }

  private open(id: AppWindowId, cwd: string, tabs: string[]): void {
    const window = this.deps.openWindow(id)
    const entry = this.track(id, false, cwd, window, tabs)
    window.on('close', () => {
      if (entry.keep || this.shuttingDown) return
      // Closed by the user: its chats return to the main window and the window is forgotten.
      this.deps.store.remove(id)
      this.deps.forgetPlacement(id)
      const main = this.entries.get(MAIN_WINDOW_ID)
      if (main && entry.tabIds.length) this.command(main, { type: 'adoptTabs', tabIds: [...entry.tabIds] })
    })
  }

  private track(id: AppWindowId, main: boolean, cwd: string | null, window: RegistryWindow, tabs: string[]): Entry {
    const entry: Entry = { id, main, cwd, window, visible: new Set(), tabIds: [...tabs], initialTabs: [...tabs], keep: false }
    this.entries.set(id, entry)
    // Renderers read focus from the list: a window only adopts selections made while it is in front.
    window.on('focus', () => this.broadcastWindows())
    window.on('blur', () => this.broadcastWindows())
    window.on('closed', () => {
      if (this.entries.get(id) === entry) this.entries.delete(id)
      // At quit the chat service has already stopped; there is nothing left to release.
      if (!this.shuttingDown) this.deps.releaseChats(id)
      this.broadcastWindows()
    })
    this.broadcastWindows()
    return entry
  }

  private require(contents: Pick<WebContents, 'id'>): Entry {
    const id = this.idOf(contents)
    const entry = id ? this.entries.get(id) : undefined
    if (!entry) throw new Error('This window is not registered')
    return entry
  }

  private raise(entry: Entry): void {
    if (entry.window.isMinimized()) entry.window.restore()
    entry.window.show()
    entry.window.focus()
  }

  private command(entry: Entry, command: AppWindowCommand): void {
    deliver(entry, IPC.event.windowsEvent, { type: 'command', command })
  }

  private broadcastWindows(): void {
    this.send(IPC.event.windowsEvent, { type: 'windows', windows: this.list() })
  }
}

// The BrowserWindow can outlive its WebContents during shutdown; late events are harmless.
function deliver<C extends IpcEventChannel>(entry: Entry, channel: C, payload: IpcEventChannels[C]): void {
  if (entry.window.isDestroyed() || entry.window.webContents.isDestroyed()) return
  entry.window.webContents.send(channel, payload)
}
