import type { ChatProvider } from './chat.js'

export type BrowserBounds = {
  x: number
  y: number
  width: number
  height: number
  // When false, the native browser view is hidden outright rather than positioned — used
  // when the workspace shows the editor instead of the browser. Optional so existing callers
  // (which always mean "visible") stay unchanged. See BrowserService.setBounds.
  visible?: boolean
  // A renderer overlay covers this surface. Unlike `visible: false`, occlusion must not
  // detach the live WebContentsView: modals are temporary and must never disturb the page.
  occluded?: boolean
}

export type BrowserNavigationError = {
  /** The main-frame URL Chromium failed to load. */
  url: string
  /** The last usable page, used for a safe recovery action after provisional loads. */
  previousUrl: string
  /** Chromium net error name, for example ERR_SSL_PROTOCOL_ERROR. */
  code: string
  /** Chromium's numeric network error when Electron supplied one. */
  errno: number | null
  title: string
  summary: string
  suggestions: string[]
  at: number
}

export type BrowserState = {
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** Main-frame failure shown in browser chrome; absent on older persisted snapshots. */
  navigationError?: BrowserNavigationError | null
}

// One entry per open tab, in display order. Emitted together as a list so the renderer
// can render the whole strip from a single event.

export type BrowserTabInfo = {
  id: string
  // 1-based left-to-right position in the tab strip. `id` is a monotonic creation counter
  // that is never reused; `pos` shifts whenever tabs open or close.
  pos: number
  title: string
  customTitle?: string | null
  url: string
  favicon: string | null
  isLoading: boolean
  active: boolean
}


export type BrowserDownloadState = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'

// One file arriving from the embedded browser. `path` is absolute; `relativePath` is
// resolved against the downloads root.

export type BrowserDownload = {
  id: string
  url: string
  filename: string
  path: string
  relativePath: string
  mimeType: string
  state: BrowserDownloadState
  receivedBytes: number
  /** 0 when the server sent no Content-Length, which the UI shows as an indeterminate size. */
  totalBytes: number
  bytesPerSecond: number
  canResume: boolean
  error: string | null
}

export type ChatContinuation = {
  /** Stable lineage retained after the one-shot handoff has been delivered. */
  sourcePaneId: string | null
  sourceThreadId: string | null
  sourceProvider: ChatProvider
  sourceTitle: string
  /** Cleared after the destination's first turn is accepted; lineage remains. */
  handoff: string | null
  createdAt: number
  /** Snapshot boundary: source recall must not expose later messages, including after a branch. */
  sourceThroughItemId?: string | null
  /** Checkpoint captured at continuation time; not a live pointer to the source's latest notes. */
  checkpoint?: import('./chat-memory.js').ChatMemoryCheckpoint | null
}

export type ChatPeerRecord = {
  paneId: string
  provider: ChatProvider
  threadId: string | null
  codexThreadId: string | null
  claudeSessionId: string | null
  /** The `agy` conversation this pane continues; absent on records saved before Antigravity existed. */
  antigravityConversationId?: string | null
  /** The ACP session this pane continues; absent on records saved before Cursor existed. */
  cursorSessionId?: string | null
  modelId: string | null
  reasoningEffort: string | null
  /** The chat this pane continued from, including a restart-safe one-shot digest. */
  continuation?: ChatContinuation | null
  /** One bounded checkpoint for this pane; usable only for its recorded provider thread. */
  checkpoint?: import('./chat-memory.js').ChatMemoryCheckpoint | null
  /**
   * Last known display title, kept so a parked pane (no runtime, empty snapshot) still names
   * itself after a relaunch. Refreshed whenever the live title changes.
   */
  title?: string | null
  /** Unix milliseconds of the pane's last turn boundary; survives relaunch like the title. */
  updatedAt?: number | null
}

/** Open panes are scoped to their working directory so changing projects never discards chats. */
export type ChatWorkspaceRecord = {
  cwd: string
  projectPath: string | null
  /** Chat ids attached as panes in this workspace; their records live in the chat store. */
  openIds: string[]
  /** Pane records written before the chat store existed; imported once, then emptied. */
  peers: ChatPeerRecord[]
  selectedPaneId: string | null
}

export type AppSettings = {
  browserCookiesImported: boolean
  /** Current directory for new chat services; null uses the application checkout on first launch. */
  chatWorkspacePath: string | null
  /** The selected project directory. Null means the user chose the non-project workspace. */
  chatProjectPath: string | null
  /** Saved pane sets for projects that are not currently active. */
  chatWorkspaces: ChatWorkspaceRecord[]
  /** Last app-server (Codex) thread selected by the single chat surface. */
  chatThreadId: string | null
  /** Last Claude Agent SDK session the chat surface showed; resumed on the next Claude turn. */
  chatClaudeSessionId: string | null
  /** Last Antigravity (`agy`) conversation the chat surface showed; resumed on the next Antigravity turn. */
  chatAntigravityConversationId: string | null
  /** Last Cursor ACP session the chat surface showed; reloaded on the next Cursor turn. */
  chatCursorSessionId: string | null
  /** User's preferred model for new chats; a `claude:`, `agy:`, or `cursor:` prefix selects that provider. */
  chatModelId: string | null
  /** User's preferred reasoning effort when the selected model supports it. */
  chatReasoningEffort: string | null
  /** Selected-pane projection of `ChatPeerRecord.continuation`. */
  chatContinuation: ChatContinuation | null
  /** Chat ids attached as panes in the active workspace; their records live in the chat store. */
  chatOpenIds: string[]
  /**
   * Pane records written before the chat store existed. Imported into the store on the first
   * launch that has one and emptied afterwards; the legacy single-chat fields above are the
   * still older form of the same data.
   */
  chatPeers: ChatPeerRecord[]
  chatSelectedPaneId: string | null
  /** `namespace.tool` ids the user switched off in the Tools modal. */
  disabledTools: string[]
  /** Maximum inner calls accepted by one tool_batch.run invocation. Applied at startup. */
  toolBatchMaxCalls: number
  /**
   * Compact the Codex thread once a completed turn leaves the context this full, as a
   * percentage of the model window. 0 disables this trigger, independently of the token trigger.
   */
  chatCompactAtPercent: number
  /** Opt-in Codex between-turn token threshold (not a hard cap). 0 disables; 20k–2M otherwise. */
  chatCompactAtTokens: number
  /**
   * Opt-in: have Codex compact in the middle of a turn once the context passes this many tokens.
   * 0 (default) keeps Codex's own near-limit compaction. Compaction can lose detail and delay
   * the next response; compare first-text timing and cache reuse before lowering this limit.
   */
  chatMidTurnCompactTokens: number
}

/** A still of the page the user is looking at; `imageUrl` is a data URL. */
export type BrowserShot = {
  imageUrl: string
  tabId: string
  url: string
  title: string
}
