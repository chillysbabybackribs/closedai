import type { BrowserHistoryMatch } from './browser-history.js'
import type { BrowserBounds, BrowserDownload, BrowserShot, BrowserState, BrowserTabInfo } from './types.js'
import type { ChatAttachment, ChatHistoryPage } from './chat.js'
import type { ChatContinuationSource, ChatPaneId, ChatRowSummary, ChatWorkspaceEvent, ChatWorkspaceSnapshot } from './chat-peers.js'
import type { ToolManifest, ToolTelemetrySnapshot, ToolsEvent } from './tools.js'
import type { TraceEvent, TraceSnapshot } from './trace.js'

export type Unsubscribe = () => void

/** The contextBridge surface the renderer sees as `window.closedai`. */
export type ClosedaiApi = {
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
  }
  browser: {
    setBounds: (bounds: BrowserBounds) => Promise<void>
    navigate: (input: string) => Promise<void>
    back: () => Promise<void>
    forward: () => Promise<void>
    reload: () => Promise<void>
    suggest: (input: string) => Promise<{ completion: string; url: string } | null>
    searchHistory: (input: string) => Promise<BrowserHistoryMatch[]>
    removeHistory: (url: string) => Promise<void>
    snapshot: () => Promise<{ state: BrowserState; tabs: BrowserTabInfo[] } | null>
    newTab: () => Promise<void>
    newTabToRight: (id: string) => Promise<void>
    openTab: (input: string) => Promise<void>
    closeTab: (id: string) => Promise<void>
    closeOtherTabs: (id: string) => Promise<void>
    closeTabsToRight: (id: string) => Promise<void>
    duplicateTab: (id: string) => Promise<void>
    reloadTab: (id: string) => Promise<void>
    renameTab: (id: string, title: string | null) => Promise<void>
    selectTab: (id: string) => Promise<void>
    /** Still of the active tab, used to freeze the page under a DOM overlay. */
    capture: () => Promise<BrowserShot | null>
    onState: (listener: (state: BrowserState) => void) => Unsubscribe
    onTabs: (listener: (tabs: BrowserTabInfo[]) => void) => Unsubscribe
  }
  browserDownloads: {
    list: () => Promise<BrowserDownload[]>
    pause: (id: string) => Promise<void>
    resume: (id: string) => Promise<void>
    cancel: (id: string) => Promise<void>
    reveal: (id: string) => Promise<void>
    clear: () => Promise<void>
    onChanged: (listener: (downloads: BrowserDownload[]) => void) => Unsubscribe
  }
  chat: {
    snapshot: () => Promise<ChatWorkspaceSnapshot>
    historyPage: (paneId: ChatPaneId, threadId: string | null, beforeItemId: string) => Promise<ChatHistoryPage>
    send: (paneId: ChatPaneId, text: string, attachments: ChatAttachment[]) => Promise<void>
    /** Resolve an OS-backed File without exposing Electron APIs to the renderer. */
    attachmentPath: (file: File) => string
    interrupt: (paneId: ChatPaneId) => Promise<void>
    selectPane: (paneId: ChatPaneId) => Promise<void>
    setVisiblePanes: (cwd: string, paneIds: ChatPaneId[]) => Promise<void>
    selectModel: (paneId: ChatPaneId, modelId: string) => Promise<void>
    selectReasoningEffort: (paneId: ChatPaneId, effort: string) => Promise<void>
    /** Re-read the pane provider's subscription usage; a no-op where it is not reported. */
    refreshPlanUsage: (paneId: ChatPaneId) => Promise<void>
    loginWithChatGPT: () => Promise<void>
    /** Every chat of this workspace from the app's own store, newest first; provider catalogs are reconciled behind it. */
    listChats: () => Promise<ChatRowSummary[]>
    /** Clear the pane; the next message starts a fresh app-server thread. */
    newPeer: () => Promise<ChatPaneId>
    /** Retire an open peer pane from the active workspace shelf back to history. */
    closePeer: (paneId: ChatPaneId) => Promise<void>
    /** Create a new pane whose first message carries a compact digest of the exact source chat. */
    continueInNewPeer: (source: ChatContinuationSource, modelId: string | null) => Promise<ChatPaneId>
    /** Show a chat by its stable id. Main selects it if attached, else attaches it — replacing the selected chat only when that one is blank. */
    openChat: (chatId: string) => Promise<ChatPaneId>
    /** Hide a chat from the workspace: its provider thread is archived and its pane, if any, closed. */
    archiveChat: (chatId: string) => Promise<void>
    setChatPinned: (chatId: string, pinned: boolean) => Promise<void>
    /** Re-seed provider-side context from a bounded summary when the active provider supports it. */
    compactConversation: (paneId: ChatPaneId) => Promise<void>
    /** Choose a project directory and restore its saved panes, or create its first chat. */
    chooseProject: () => Promise<void>
    /** Switch directly to a project already stored in the recent-project list. */
    selectProject: (projectPath: string) => Promise<void>
    /** Switch to the non-project home workspace, restoring its saved panes when available. */
    clearProject: () => Promise<void>
    onEvent: (listener: (event: ChatWorkspaceEvent) => void) => Unsubscribe
  }
  tools: {
    manifest: () => Promise<ToolManifest>
    telemetry: () => Promise<ToolTelemetrySnapshot>
    clearTelemetry: () => Promise<void>
    /** Persisted. Takes effect for calls immediately and for advertising on the next thread. */
    setEnabled: (toolId: string, enabled: boolean) => Promise<void>
    onEvent: (listener: (event: ToolsEvent) => void) => Unsubscribe
  }
  /** The live turn trace: in-memory, every pane, cleared at restart or on request. */
  trace: {
    setActive: (active: boolean) => Promise<void>
    snapshot: () => Promise<TraceSnapshot>
    clear: () => Promise<void>
    onEvent: (listener: (event: TraceEvent) => void) => Unsubscribe
  }
}
