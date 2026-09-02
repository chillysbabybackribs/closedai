import type { BrowserBounds, BrowserDownload, BrowserShot, BrowserState, BrowserTabInfo } from './types.js'
import type { ChatAttachment, ChatEvent, ChatSnapshot, ChatThreadSummary } from './chat.js'
import type { ToolManifest, ToolTelemetrySnapshot, ToolsEvent } from './tools.js'
import type { OperationsEvent, OperationsModelCatalog, OperationsRun, OperationsSnapshot, RunStatus } from './operations.js'

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
    snapshot: () => Promise<{ state: BrowserState; tabs: BrowserTabInfo[] } | null>
    newTab: () => Promise<void>
    openTab: (input: string) => Promise<void>
    closeTab: (id: string) => Promise<void>
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
    snapshot: () => Promise<ChatSnapshot>
    send: (text: string, attachments: ChatAttachment[]) => Promise<void>
    /** Resolve an OS-backed File without exposing Electron APIs to the renderer. */
    attachmentPath: (file: File) => string
    interrupt: () => Promise<void>
    selectModel: (modelId: string) => Promise<void>
    loginWithChatGPT: () => Promise<void>
    /** Threads recorded for this workspace, newest first. */
    listThreads: () => Promise<ChatThreadSummary[]>
    /** Clear the pane; the next message starts a fresh app-server thread. */
    newThread: () => Promise<void>
    /** Clear the pane; the next message starts a fresh thread carrying a digest of this one. */
    continueInNewThread: () => Promise<void>
    openThread: (threadId: string) => Promise<void>
    archiveThread: (threadId: string) => Promise<void>
    onEvent: (listener: (event: ChatEvent) => void) => Unsubscribe
  }
  tools: {
    manifest: () => Promise<ToolManifest>
    telemetry: () => Promise<ToolTelemetrySnapshot>
    clearTelemetry: () => Promise<void>
    /** Persisted. Takes effect for calls immediately and for advertising on the next thread. */
    setEnabled: (toolId: string, enabled: boolean) => Promise<void>
    onEvent: (listener: (event: ToolsEvent) => void) => Unsubscribe
  }
  operations: {
    snapshot: () => Promise<OperationsSnapshot>
    models: () => Promise<OperationsModelCatalog>
    create: (task: string, workspace: string, modelId: string) => Promise<OperationsRun>
    setStatus: (id: number, status: RunStatus) => Promise<void>
    onChanged: (listener: (event: OperationsEvent) => void) => Unsubscribe
  }
}
