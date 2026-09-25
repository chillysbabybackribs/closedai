import { useSyncExternalStore } from 'react'
import {
  APP_WINDOW_QUERY, MAIN_WINDOW_ID, type AppWindowCommand, type AppWindowContext, type AppWindowInfo
} from '../../shared/app-windows.js'

// Which app window this renderer is, and what the other windows hold. Loaded once before the
// app renders, so the first layout already knows which chats live elsewhere and are not its own.

type Snapshot = { self: AppWindowContext; windows: AppWindowInfo[] }

const detachedId = new URLSearchParams(window.location.search).get(APP_WINDOW_QUERY)
let snapshot: Snapshot = {
  self: { id: detachedId ?? MAIN_WINDOW_ID, main: !detachedId, cwd: null, initialTabs: [] },
  windows: []
}
const listeners = new Set<() => void>()
const commandListeners = new Set<(command: AppWindowCommand) => void>()
// A command can arrive before the layout that handles it has mounted.
const pendingCommands: AppWindowCommand[] = []

function publish(next: Snapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

/** Read this window's identity and the window list, then follow changes. Never rejects. */
export async function loadAppWindows(): Promise<void> {
  window.closedai.windows.onEvent((event) => {
    if (event.type === 'windows') publish({ ...snapshot, windows: event.windows })
    else if (commandListeners.size) for (const listener of commandListeners) listener(event.command)
    else pendingCommands.push(event.command)
  })
  try {
    const [self, windows] = await Promise.all([window.closedai.windows.context(), window.closedai.windows.list()])
    publish({ self, windows })
  } catch (error) {
    console.warn('[windows] could not read this window’s identity', error)
  }
}

export function appWindow(): AppWindowContext {
  return snapshot.self
}

/** Chat and view tabs that another open window holds. */
export function tabsHeldElsewhere(): Set<string> {
  return new Set(snapshot.windows.filter((entry) => entry.id !== snapshot.self.id).flatMap((entry) => entry.tabIds))
}

/**
 * Whether a chat no window holds yet (a new chat, one a tool opened) belongs here: to the window in
 * front, or to the main window when no app window is. Focus comes from main, which tracks every
 * window; a renderer's own `document.hasFocus()` can report true for a window behind another.
 */
export function adoptsUnheldChats(): boolean {
  const focused = snapshot.windows.find((entry) => entry.focused)
  return focused ? focused.id === snapshot.self.id : snapshot.self.main
}

export function useAppWindows(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function onAppWindowCommand(listener: (command: AppWindowCommand) => void): () => void {
  commandListeners.add(listener)
  for (const command of pendingCommands.splice(0)) listener(command)
  return () => commandListeners.delete(listener)
}
