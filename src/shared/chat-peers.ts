import type { ChatProvider, ChatSnapshot, ChatTranscriptItem } from './chat.js'

export type ChatPaneId = string

export type ChatPeerKind = 'peer' | 'subagent'

export type ChatPeerSummary = {
  paneId: ChatPaneId
  parentPaneId: ChatPaneId | null
  kind: ChatPeerKind
  provider: ChatProvider
  modelId: string | null
  threadId: string | null
  title: string
  preview: string
  running: boolean
  activity: string | null
  updatedAt: number
}

export type ChatContinuationSource = {
  /** Include conversation only through this completed assistant message. */
  throughItemId?: string
  paneId: ChatPaneId | null
  threadId: string | null
}

export type ChatWorkspaceSnapshot = {
  selectedPaneId: ChatPaneId
  peers: ChatPeerSummary[]
  selected: ChatSnapshot
  /** The directory used by newly created provider sessions and its optional project identity. */
  workspace?: {
    cwd: string
    projectPath: string | null
    /** Previously used project folders, newest first, excluding the active project. */
    recentProjects?: Array<{ cwd: string; projectPath: string }>
  }
}

export type ChatWorkspaceEvent =
  | { type: 'workspace'; snapshot: ChatWorkspaceSnapshot }
  | { type: 'pane'; paneId: ChatPaneId; event: import('./chat.js').ChatEvent }
  | { type: 'peers'; selectedPaneId: ChatPaneId; peers: ChatPeerSummary[] }

export type PeerChatReadResult = ChatPeerSummary & {
  items: ChatTranscriptItem[]
  nextCursor: number | null
}
