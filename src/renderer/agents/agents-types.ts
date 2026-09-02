import type { ChatThreadSummary } from '../../shared/chat.js'
import type { ChatPeerSummary } from '../../shared/chat-peers.js'

export type AgentStatus = 'running' | 'queued' | 'done' | 'failed' | 'stopped' | 'chat'

export type AgentRowModel = {
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
  status: AgentStatus
  peer?: ChatPeerSummary
  thread?: ChatThreadSummary
  completedUnviewed: boolean
  children: AgentRowModel[]
}

export type AgentSections = {
  running: AgentRowModel[]
  reviewQueue: AgentRowModel[]
  recentlyCompleted: AgentRowModel[]
  completed: AgentRowModel[]
  history: AgentRowModel[]
}

export type DirectoryGroup = {
  key: string
  label: string
  fullPath: string | null
  rows: AgentRowModel[]
}
