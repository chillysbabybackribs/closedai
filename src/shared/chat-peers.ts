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

/**
 * One drawer row: a chat record plus what its runtime, if attached, currently reports. The id is
 * the chat's stable store id, which is also its pane id while it is attached, so the same row
 * survives detaching, relaunching, and moving between drawer sections.
 */
export type ChatRowSummary = ChatPeerSummary & {
  /** Whether a pane (a live or parked runtime) exists for this chat right now. */
  attached: boolean
  pinnedAt: number | null
  cwd: string
  createdAt: number
  lastTurnEndedAt: number | null
}

export type ChatContinuationSource = {
  /** Include conversation only through this completed assistant message. */
  throughItemId?: string
  paneId: ChatPaneId | null
  threadId: string | null
}

export type ChatWorkspaceSnapshot = {
  selectedPaneId: ChatPaneId
  /** Every chat of the active workspace, attached or not; see `ChatRowSummary`. */
  chats: ChatRowSummary[]
  selected: ChatSnapshot
  /** Bounded snapshots for chats displayed together; selection is keyboard focus, not visibility. */
  panes?: Record<ChatPaneId, ChatSnapshot>
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
  | { type: 'chats'; selectedPaneId: ChatPaneId; chats: ChatRowSummary[] }

export type PeerChatReadResult = ChatPeerSummary & {
  items: ChatTranscriptItem[]
  nextCursor: number | null
}
