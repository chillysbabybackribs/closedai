import type { ChatProvider, ChatThreadSummary } from '../../shared/chat.js'
import type { ChatPeerSummary } from '../../shared/chat-peers.js'

export type DrawerRowStatus = 'running' | 'queued' | 'done' | 'failed' | 'stopped' | 'chat'

export type DrawerRowModel = {
  id: string
  threadId: string | null
  paneId?: string
  title: string
  cwd: string | null
  updatedAt: number
  messageCount: number
  linesAdded: number
  linesRemoved: number
  running: boolean
  status: DrawerRowStatus
  /** Set for rows backed by a live pane — the selected chat and every peer. Absent on history
   *  rows, which are thread records with no runtime behind them. Drives the provider mark. */
  provider?: ChatProvider
  peer?: ChatPeerSummary
  thread?: ChatThreadSummary
  children: DrawerRowModel[]
}

/**
 * Three sections, each with a stable order. Rows move on turn boundaries and reviewed-completion
 * expiry, never merely because selection changed.
 */
export type DrawerSections = {
  /** Running panes, plus parents needed to expose running descendants. */
  current: DrawerRowModel[]
  /** Panes whose turn has finished, newest completion first. They return to Current only when a
   *  message is sent in them, so opening one to read it leaves it where it is. */
  reviewQueue: DrawerRowModel[]
  /** Idle pane rows and thread records with no pane behind them. */
  history: DrawerRowModel[]
}

export type DirectoryGroup = {
  key: string
  label: string
  fullPath: string | null
  rows: DrawerRowModel[]
}
