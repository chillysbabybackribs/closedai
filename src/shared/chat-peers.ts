import type { ChatProvider, ChatSnapshot, ChatTranscriptItem } from './chat.js'
import type { QuickChatSurface } from './quick-chat-overlay.js'

export type ChatPaneId = string

/** How long trash/archive stays reversible before the provider thread is archived. */
export const ARCHIVE_UNDO_MS = 8000

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
  /** Explicit provider pause state; absent for saved chats without a live runtime. */
  paused?: boolean
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
  projectPath?: string | null
  /** A directory chosen for this chat that is waiting for its running work to finish. */
  pendingProject?: { cwd: string; projectPath: string | null }
  /**
   * The chat this one continues ("Continue in new chat", a branch, or a project switch). The digest
   * is present only until the first message delivers it, so an empty continued pane can show what
   * it is about to carry; a directory change within one chat is not a continuation.
   */
  continuedFrom?: {
    paneId: string | null
    title: string
    handoff: string | null
    previewUser?: string | null
    previewAssistant?: string | null
  }
  createdAt: number
  lastTurnEndedAt: number | null
  quickChatSurface?: QuickChatSurface | null
}

/**
 * `select: false` creates the chat without selecting it; the caller reports it visible (the browser's
 * quick chat). `modelId` starts it on that model instead of the anchor's (the quick chat keeps its own).
 */
export type ChatNewPeerOptions = { select?: boolean; modelId?: string; quickChatSurface?: QuickChatSurface }

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
