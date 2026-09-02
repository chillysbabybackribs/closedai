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


export type AppSettings = {
  browserCookiesImported: boolean
  /** Last app-server (Codex) thread selected by the single chat surface. */
  chatThreadId: string | null
  /** Last Claude Agent SDK session the chat surface showed; resumed on the next Claude turn. */
  chatClaudeSessionId: string | null
  /** User's preferred model for new chats; a `claude:` prefix selects the Claude provider. */
  chatModelId: string | null
  /** User's preferred reasoning effort when the selected model supports it. */
  chatReasoningEffort: string | null
  /** `namespace.tool` ids the user switched off in the Tools modal. */
  disabledTools: string[]
  /** Maximum inner calls accepted by one tool_batch.run invocation. Applied at startup. */
  toolBatchMaxCalls: number
  /**
   * Compact the Codex thread once a completed turn leaves the context this full, as a
   * percentage of the model window. 0 leaves it to Codex's own near-limit compaction.
   */
  chatCompactAtPercent: number
  /**
   * Opt-in: have Codex compact in the middle of a turn once the context passes this many tokens.
   * 0 (default) keeps Codex's own near-limit compaction. Measured 2026-09-02: with prompt caching
   * a model step costs about the same at 200k context as at 40k, while each compaction costs
   * 60-90 seconds and loses detail, so an early limit only makes sense to cap spend.
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
