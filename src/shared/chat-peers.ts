import type { ChatProvider, ChatSnapshot, ChatTranscriptItem } from './chat.js'

export type ChatPaneId = string

export type ProjectSwitchRequest = {
  paneId: string
  threadId: string
  turnId: string
  projectPath: string
}

export type ProjectSwitchStatus = ProjectSwitchRequest & {
  status: 'pending' | 'switching' | 'completed' | 'cancelled' | 'failed'
  destinationPaneId?: string
  error?: string
}

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
  /** Chats across directories, attached or not; see `ChatRowSummary`. */
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
  /** App-wide preferences surfaced for renderer policy (e.g. manual compact availability). */
  preferences?: {
    chatSeamlessRotation: boolean
  }
}

export type ChatWorkspaceEvent =
  | { type: 'workspace'; snapshot: ChatWorkspaceSnapshot }
  | { type: 'pane'; paneId: ChatPaneId; event: import('./chat.js').ChatEvent }
  | { type: 'chats'; selectedPaneId: ChatPaneId; chats: ChatRowSummary[] }

/** Serialized character budget for one peer page, and the ceiling a caller may raise it to. */
export const PEER_READ_DEFAULT_CHARS = 6_000
export const PEER_READ_MAX_CHARS = 16_000

export type PeerChatReadOptions = {
  /** Readable items already seen at the paging end: the newest for `newest`, the first for `oldest`. */
  cursor: number
  limit: number
  /** `newest` pages backwards from the live end of the transcript, `oldest` forwards from its start. */
  order: 'newest' | 'oldest'
  /** Transcript item types to keep; every readable type when omitted or empty. */
  types?: readonly ChatTranscriptItem['type'][]
  /** Budget for the returned items. Long fields are clipped to fit it before items are dropped. */
  maxChars: number
}

export type PeerChatReadResult = ChatPeerSummary & {
  items: ChatTranscriptItem[]
  /** Readable items matching `types` in the whole transcript, so a page can be placed in it. */
  totalItems: number
  /** `saved` when the chat is parked and these items are the app's saved tail of it, not a live
   *  provider replay: the newest items are current, but the conversation reaches further back. */
  itemSource: 'live' | 'saved'
  nextCursor: number | null
}
