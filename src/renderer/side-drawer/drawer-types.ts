import type { ChatProvider } from '../../shared/chat.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'

export type DrawerRowStatus = 'running' | 'queued' | 'done' | 'failed' | 'stopped' | 'chat'

/**
 * One drawer row per chat record. The id is the chat's stable store id — also its pane id while
 * attached — so a row keeps its identity, and its completion mark, across detaching, relaunch, and
 * every move between sections.
 */
export type DrawerRowModel = {
  id: string
  threadId: string | null
  /** Set (equal to `id`) while the chat has a pane; absent for a detached record. */
  paneId?: string
  title: string
  cwd: string | null
  createdAt: number
  updatedAt: number
  messageCount: number
  linesAdded: number
  linesRemoved: number
  running: boolean
  status: DrawerRowStatus
  /** Drives the provider mark; every record names its provider, attached or not. */
  provider: ChatProvider
  chat: ChatRowSummary
  children: DrawerRowModel[]
  activity?: string | null
}

/**
 * Four sections, each with a stable order. Unpinned rows move on turn boundaries and reviewed-completion
 * expiry, never merely because selection changed.
 */
export type DrawerSections = {
  /** Pinned chats stay above all activity sections, newest pin first. */
  pinned: DrawerRowModel[]
  /** Running chats, newest created first, plus parents needed to expose running descendants. */
  current: DrawerRowModel[]
  /** Chats whose turn has finished, newest completion first. They return to Current only when a
   *  message is sent in them, so opening one to read it leaves it where it is. */
  reviewQueue: DrawerRowModel[]
  /** Every other chat of the workspace, attached or not, newest activity first. */
  history: DrawerRowModel[]
}

export type DirectoryGroup = {
  key: string
  label: string
  fullPath: string | null
  rows: DrawerRowModel[]
}
