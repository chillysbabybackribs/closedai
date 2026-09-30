import type { AgentRun, AgentRunStartOptions, AgentRunsEvent } from './agent-runs.js'
import type { SavedAgent, SavedAgentDraft, SavedAgentPatch } from './agent-library.js'
import type { BrowserHistoryMatch } from './browser-history.js'
import type { BrowserBounds, BrowserDownload, BrowserShot, BrowserState, BrowserTabInfo } from './types.js'
import type { SavedSite, SavedSiteDraft, SavedSitePatch } from './saved-sites.js'
import type { NoteChange, NoteDoc, NoteMeta, NoteSaveResult, NotepadBinding } from './notes.js'
import type { ChatAttachment, ChatHistoryPage } from './chat.js'
import type {
  ChatContinuationSource, ChatNewPeerOptions, ChatPaneId, ChatRowSummary, ChatWorkspaceEvent, ChatWorkspaceSnapshot
} from './chat-peers.js'
import type { ProviderAvailability } from './provider-availability.js'
import type { AppWindowContext, AppWindowId, AppWindowInfo, AppWindowRegion, AppWindowsEvent } from './app-windows.js'
import type { QuickChatOverlayRequest, QuickChatOverlaySize, QuickChatOverlayState, QuickChatOverlayView } from './quick-chat-overlay.js'
import type { CredentialDraft, CredentialSummary, CredentialVaultStatus } from './credentials.js'
import type { ModelManifest, ModelSwitch, ModelsEvent } from './model-settings.js'
import type { ToolManifest, ToolTelemetrySnapshot, ToolsEvent } from './tools.js'
import type { TraceEvent, TraceSnapshot, TraceSnapshotOptions } from './trace.js'
import type {
  BrowserCookieImportResult, CredentialApprovalRequest, SecurityDecision, SecuritySettings, WebPermissionRequest
} from './security.js'
export type Unsubscribe = () => void

/** The contextBridge surface the renderer sees as `window.closedai`. */
export type ClosedaiApi = {
  localFiles: {
    open: (href: string, options?: import('./local-files.js').LocalFileOpenOptions) => Promise<import('./local-files.js').LocalFileResult>
    openImage: (image: { name: string; src: string }) => Promise<string>
    image: (id: string) => Promise<import('./local-files.js').ImageTabContent>
    revealImage: (id: string) => Promise<void>
    file: (id: string) => Promise<import('./local-files.js').FileTabContent>
    revealFile: (id: string) => Promise<void>
    /** Show a local HTML or SVG tab as its rendered page or its source, in place. */
    setView: (id: string, view: import('./local-files.js').FileView) => Promise<void>
  }
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    toggleFullscreen: () => Promise<void>
    close: () => Promise<void>
    /** Developer menu: open or close DevTools for the app window itself, not a browser tab. */
    toggleDevTools: () => Promise<void>
    /** The OS desktop wallpaper for the workspace backdrop; null when the desktop has none the app can paint. */
    desktopWallpaper: () => Promise<import('./desktop-wallpaper.js').DesktopWallpaper | null>
  }
  /** Images the user added to the wallpaper picker; main keeps the files under the profile. */
  wallpapers: {
    list: () => Promise<import('./wallpaper-uploads.js').WallpaperUpload[]>
    /** Rejects an unsupported type or an image over the size cap. */
    add: (draft: import('./wallpaper-uploads.js').WallpaperUploadDraft) => Promise<import('./wallpaper-uploads.js').WallpaperUpload>
    /** Full image bytes for the backdrop; null once the upload is gone. */
    read: (id: string) => Promise<import('./desktop-wallpaper.js').DesktopWallpaper | null>
    remove: (id: string) => Promise<void>
  }
  /** Local accounts: main keeps the list, and each account has its own data directory. */
  profiles: {
    /** The account list and the profile this process has open, read before the first paint. */
    bootstrap: () => import('./local-profiles.js').ProfileBootstrap
    /** Store the onboarding settings; the answer names the profile that owns the open data. */
    write: (onboarding: string) => import('./local-profiles.js').ProfileWriteResult
    /** Relaunch into the signed-in account's workspace; false when it is already the open one. */
    switchTo: (userId: string) => Promise<boolean>
    /** Delete an account and move its workspace data to the trash. */
    remove: (userId: string) => Promise<import('./local-profiles.js').ProfileRemoveResult>
  }
  /** The app's windows: which one this renderer is, and moving chat tabs between them. */
  windows: {
    context: () => Promise<AppWindowContext>
    list: () => Promise<AppWindowInfo[]>
    /** Open a new window for this project holding these tabs; resolves once main has recorded it. */
    detachTabs: (cwd: string, tabIds: string[]) => Promise<AppWindowId>
    /** Move tabs from this detached window back into the main window. */
    returnTabs: (tabIds: string[]) => Promise<void>
    /** Focus the other window holding this tab; false when no other window holds it. */
    revealTab: (tabId: string) => Promise<boolean>
    /** Raise the main window and show its browser. */
    showBrowser: () => Promise<void>
    /** A still of this window's own page within `region` (JPEG data URL); null when nothing painted. */
    capture: (region: AppWindowRegion) => Promise<string | null>
    reportDockSurface: (region: AppWindowRegion | null) => Promise<void>
    routeCrossDock: (request: import('./cross-window-dock.js').CrossWindowDockRouteRequest) => Promise<import('./cross-window-dock.js').CrossWindowDockRouteResult>
    completeCrossDock: (payload: import('./cross-window-dock.js').CrossWindowDockComplete) => Promise<void>
    onEvent: (listener: (event: AppWindowsEvent) => void) => Unsubscribe
  }
  /** The browser's quick chat layer (shared/quick-chat-overlay.ts). */
  quickChat: {
    /** Main window: which chat the layer shows and whether it is open. */
    setState: (state: QuickChatOverlayState) => Promise<void>
    /** The layer: what to render now; null before the main window reported any state. */
    view: () => Promise<QuickChatOverlayView | null>
    /** The layer: its content box, which main anchors to the foot of the page. */
    setSize: (size: QuickChatOverlaySize) => Promise<void>
    /** The layer: ask the main window's layout to open, renew or close the quick chat. */
    request: (request: QuickChatOverlayRequest) => Promise<void>
    onView: (listener: (view: QuickChatOverlayView) => void) => Unsubscribe
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
    /** Answer a page's permission request shown in the browser chrome while the policy is `ask`. */
    resolvePermission: (id: string, decision: SecurityDecision) => Promise<void>
    onState: (listener: (state: BrowserState) => void) => Unsubscribe
    onTabs: (listener: (tabs: BrowserTabInfo[]) => void) => Unsubscribe
    /** The full pending list, sent whenever it changes; empty when nothing is waiting. */
    onPermissionRequests: (listener: (pending: WebPermissionRequest[]) => void) => Unsubscribe
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
  /** Sites the user keeps on purpose; see src/shared/saved-sites.ts. */
  savedSites: {
    list: () => Promise<SavedSite[]>
    /** Saves a web page, or refreshes title/favicon when its URL is already saved. */
    save: (draft: SavedSiteDraft) => Promise<SavedSite>
    update: (id: string, patch: SavedSitePatch) => Promise<SavedSite | null>
    remove: (id: string) => Promise<void>
    /** The full list, sent whenever it changes. */
    onChanged: (listener: (sites: SavedSite[]) => void) => Unsubscribe
  }
  /** Notepad buffers; see src/shared/notes.ts. */
  notes: {
    list: () => Promise<NoteMeta[]>
    read: (id: string) => Promise<NoteDoc | null>
    create: (text: string) => Promise<NoteDoc>
    /** Refused, with the current note, when a model edit landed after `baseRevision`. */
    save: (id: string, text: string, baseRevision: number) => Promise<NoteSaveResult>
    rename: (id: string, title: string | null) => Promise<NoteMeta>
    remove: (id: string) => Promise<void>
    /** Tell main which notes a notepad window's chat is about. */
    bind: (binding: NotepadBinding) => Promise<void>
    unbind: (chatPaneId: string) => Promise<void>
    /** Every accepted change, with the note's new text. */
    onChanged: (listener: (change: NoteChange) => void) => Unsubscribe
  }
  chat: {
    snapshot: () => Promise<ChatWorkspaceSnapshot>
    historyPage: (paneId: ChatPaneId, threadId: string | null, beforeItemId: string) => Promise<ChatHistoryPage>
    send: (paneId: ChatPaneId, text: string, attachments: ChatAttachment[]) => Promise<void>
    /** Resolve an OS-backed File without exposing Electron APIs to the renderer. */
    attachmentPath: (file: File) => string
    interrupt: (paneId: ChatPaneId) => Promise<void>
    selectPane: (paneId: ChatPaneId) => Promise<void>
    setVisiblePanes: (cwd: string, paneIds: ChatPaneId[], retainedTabIds?: ChatPaneId[]) => Promise<void>
    selectModel: (paneId: ChatPaneId, modelId: string) => Promise<void>
    selectReasoningEffort: (paneId: ChatPaneId, effort: string) => Promise<void>
    /** Re-read the pane provider's subscription usage; a no-op where it is not reported. */
    refreshPlanUsage: (paneId: ChatPaneId) => Promise<void>
    loginWithChatGPT: () => Promise<void>
    /** Every chat of this workspace from the app's own store, newest first; provider catalogs are reconciled behind it. */
    listChats: () => Promise<ChatRowSummary[]>
    /** Clear the pane; the next message starts a fresh app-server thread. `select: false` keeps the current selection. */
    newPeer: (anchorPaneId?: ChatPaneId, options?: ChatNewPeerOptions) => Promise<ChatPaneId>
    /** Retire an open peer pane from the active workspace shelf back to history. */
    closePeer: (paneId: ChatPaneId) => Promise<void>
    /** Create a new pane whose first message carries a compact digest of the exact source chat. */
    continueInNewPeer: (source: ChatContinuationSource, modelId: string | null) => Promise<ChatPaneId>
    /** Show a chat by its stable id. Main selects it if attached, else attaches it — replacing the selected chat only when that one is blank. */
    openChat: (chatId: string) => Promise<ChatPaneId>
    /** Hide a chat from the workspace immediately; its provider thread is archived after a short undo window. */
    archiveChat: (chatId: string) => Promise<void>
    /** Restore a chat whose provider archive has not committed yet. */
    unarchiveChat: (chatId: string) => Promise<void>
    setChatPinned: (chatId: string, pinned: boolean) => Promise<void>
    /** Rename a chat with a manual title, or pass null/empty to revert to the default/generated title. */
    renameChat: (chatId: string, title: string | null) => Promise<void>
    /** Retry background auto-title generation for a completed conversation. */
    retryChatTitle: (chatId: string) => Promise<void>
    /** Re-seed provider-side context from a bounded summary when the active provider supports it. */
    compactConversation: (paneId: ChatPaneId) => Promise<void>
    /** Choose a directory for this chat, applying after its current work finishes. */
    chooseProject: (paneId: ChatPaneId) => Promise<void>
    /** Change only this chat's directory, preserving the workspace layout. */
    selectProject: (paneId: ChatPaneId, projectPath: string) => Promise<void>
    /** Use the home directory for this chat. */
    clearProject: (paneId: ChatPaneId) => Promise<void>
    /** Make a project the workspace (a space in the overview); null is the home directory. Chats keep their own folders. */
    selectSpace: (projectPath: string | null) => Promise<void>
    /** Which providers can start on this machine (binary present), with an install or sign-in sentence each; for onboarding. */
    providerAvailability: () => Promise<ProviderAvailability[]>
    /** Installed providers plus live or cached sign-in state for the first-run modal. */
    providerOnboarding: () => Promise<import('./provider-onboarding.js').ProviderOnboardingStatus[]>
    /** Open the provider's sign-in flow (browser or CLI login). */
    providerSignIn: (provider: import('./chat.js').ChatProvider) => Promise<void>
    onEvent: (listener: (event: ChatWorkspaceEvent) => void) => Unsubscribe
  }
  /** Agent runs: chats the main process keeps driving cycle after cycle; see `src/shared/agent-runs.ts`. */
  agentRuns: {
    list: () => Promise<AgentRun[]>
    /** Create the run on an open chat and send its first cycle; rejects when that send fails. */
    start: (chatId: string, options: AgentRunStartOptions) => Promise<AgentRun>
    /** Stop driving and end the turn in flight; the run keeps its cycle count for Resume. */
    pause: (chatId: string) => Promise<AgentRun | null>
    resume: (chatId: string) => Promise<AgentRun | null>
    /** End the run; the chat stays open as an ordinary chat. */
    stop: (chatId: string) => Promise<void>
    onEvent: (listener: (event: AgentRunsEvent) => void) => Unsubscribe
  }
  /** Agents the user built and kept; see `src/shared/agent-library.ts`. */
  agentLibrary: {
    list: () => Promise<SavedAgent[]>
    save: (draft: SavedAgentDraft) => Promise<SavedAgent>
    update: (id: string, patch: SavedAgentPatch) => Promise<SavedAgent | null>
    remove: (id: string) => Promise<void>
    /** The full list, sent whenever it changes, including run bookkeeping after a start. */
    onChanged: (listener: (agents: SavedAgent[]) => void) => Unsubscribe
  }
  /** OS-keychain-backed credential store. Secrets cross the bridge one field at a time, on request. */
  credentials: {
    status: () => Promise<CredentialVaultStatus>
    list: () => Promise<CredentialSummary[]>
    save: (draft: CredentialDraft) => Promise<CredentialSummary>
    /** Decrypt a single stored field; used by reveal and copy. */
    reveal: (id: string, fieldId: string) => Promise<string>
    remove: (id: string) => Promise<void>
    rename: (id: string, label: string) => Promise<CredentialSummary>
    /** Whether agents may read this entry; persisted, on by default. */
    setAgentAccess: (id: string, allowed: boolean) => Promise<CredentialSummary>
  }
  /** Settings → Security. Every default is the historical behavior; see `src/shared/security.ts`. */
  security: {
    get: () => Promise<SecuritySettings>
    set: (patch: Partial<SecuritySettings>) => Promise<SecuritySettings>
    /** Run the default-browser cookie import now, regardless of the first-launch latch. */
    importCookies: () => Promise<BrowserCookieImportResult>
    /** Answer an agent's credential read shown as a card in its chat while approval is required. */
    resolveCredentialApproval: (id: string, decision: SecurityDecision) => Promise<void>
    /** The full pending list, sent whenever it changes; empty when nothing is waiting. */
    onCredentialApprovals: (listener: (pending: CredentialApprovalRequest[]) => void) => Unsubscribe
  }
  tools: {
    manifest: () => Promise<ToolManifest>
    telemetry: () => Promise<ToolTelemetrySnapshot>
    clearTelemetry: () => Promise<void>
    /** Persisted. Takes effect for calls immediately and for advertising on the next thread. */
    setEnabled: (toolId: string, enabled: boolean) => Promise<void>
    /** Many switches, one persisted write; the caller refreshes the manifest afterwards. */
    setEnabledMany: (switches: import('./tools.js').ToolSwitch[]) => Promise<void>
    /** Codex task-slice catalog; takes effect on the next Codex send or thread rotation. */
    setChatToolSliceEnabled: (enabled: boolean) => Promise<void>
    onEvent: (listener: (event: ToolsEvent) => void) => Unsubscribe
  }
  /** Settings → Models: which catalog entries appear in the composer picker per connected provider. */
  models: {
    manifest: () => Promise<ModelManifest>
    setEnabled: (modelId: string, enabled: boolean) => Promise<void>
    setEnabledMany: (switches: ModelSwitch[]) => Promise<void>
    onEvent: (listener: (event: ModelsEvent) => void) => Unsubscribe
  }
  /** The live turn trace: in-memory, every pane, cleared at restart or on request. */
  trace: {
    setActive: (active: boolean) => Promise<void>
    snapshot: (options?: TraceSnapshotOptions) => Promise<TraceSnapshot>
    clear: () => Promise<void>
    onEvent: (listener: (event: TraceEvent) => void) => Unsubscribe
  }
}
