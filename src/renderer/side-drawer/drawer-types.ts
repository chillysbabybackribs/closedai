import type { ChatThreadSummary } from '../../shared/chat.js'
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
  peer?: ChatPeerSummary
  thread?: ChatThreadSummary
  completedUnviewed: boolean
  children: DrawerRowModel[]
}

export type DrawerSections = {
  running: DrawerRowModel[]
  reviewQueue: DrawerRowModel[]
  recentlyCompleted: DrawerRowModel[]
  completed: DrawerRowModel[]
  history: DrawerRowModel[]
}

export type DirectoryGroup = {
  key: string
  label: string
  fullPath: string | null
  rows: DrawerRowModel[]
}
