import type { ChatWorkspaceSnapshot, ChatPeerSummary, ChatWorkspaceEvent } from '../../../shared/chat-peers.js'
import type { ChatAttachment, ChatSnapshot, ChatThreadSummary } from '../../../shared/chat.js'
import type { BrowserDownload, BrowserState, BrowserTabInfo } from '../../../shared/types.js'

// Three hosts back the closedai_app namespace: deterministic state and commands come from the
// main process (the same services the renderer's IPC uses); the ui host drives real controls in
// the renderer by their stable `data-ui` id when the interaction itself is what matters.

/** How a ui action names its element: a manifest id (plus key/match to pick one row), or a raw selector. */
export type AppUiTarget = {
  control?: string
  key?: string
  /** Case-insensitive substring of the control's accessible name, for rows without a known key. */
  match?: string
  selector?: string
}

export type AppClickTarget = AppUiTarget & { x?: number; y?: number }
export type AppTypeTarget = AppUiTarget & { text: string; clear: boolean }
export type AppScrollTarget = AppUiTarget & { deltaX: number; deltaY: number }

export type AppControlFilter = { surface?: string; query?: string; maxControls: number }

export type AppControl = {
  id: string
  key?: string
  name: string
  role: string
  surface: string
  disabled?: boolean
  checked?: boolean
  selected?: boolean
  expanded?: boolean
  pressed?: boolean
  current?: boolean
  value?: string
}

export type AppControlsResult = {
  surfaces: string[]
  controls: AppControl[]
  total: number
  omitted: number
}

export type AppUiState = {
  drawerOpen: boolean
  historyOpen: boolean
  downloadsOpen: boolean
  dialogs: string[]
  menus: string[]
  composer: { enabled: boolean; running: boolean; canSend: boolean; draftLength: number } | null
  focused: { id: string; key?: string } | null
  viewport: { width: number; height: number }
}

export type AppWaitCondition = 'visible' | 'hidden' | 'enabled' | 'disabled'

export type AppWaitOptions = AppUiTarget & {
  text?: string
  condition: AppWaitCondition
  timeoutMs: number
}

export type AppConditionProbe = {
  targetVisible: number | null
  targetEnabled: number | null
  textMatched: boolean | null
}

export type AppWaitResult = AppWaitOptions & AppConditionProbe & { reached: boolean; elapsedMs: number }

export type AppUiHost = {
  controls(filter: AppControlFilter): Promise<AppControlsResult>
  uiState(): Promise<AppUiState>
  click(target: AppClickTarget): Promise<unknown>
  typeText(target: AppTypeTarget): Promise<unknown>
  pressKey(key: string, modifiers: string[]): Promise<unknown>
  scroll(target: AppScrollTarget): Promise<unknown>
  waitFor(options: AppWaitOptions, signal: AbortSignal): Promise<AppWaitResult>
}

export type AppStateSection = 'workspace' | 'chat' | 'browser' | 'downloads' | 'window'
export const APP_STATE_SECTIONS: readonly AppStateSection[] = ['workspace', 'chat', 'browser', 'downloads', 'window']

export type AppSendRequest = {
  paneId: string
  text: string
  awaitTurn: boolean
  timeoutMs: number
  signal: AbortSignal
}

export type AppSendResult = {
  paneId: string
  turnStarted: boolean
  turnCompleted: boolean
  elapsedMs: number
}

export type AppOpenChatRequest = { paneId?: string; threadId?: string; title?: string }

export type AppBrowserTabRequest = {
  op: 'new' | 'select' | 'close' | 'back' | 'forward' | 'reload'
  tabId?: string
  url?: string
}

export type AppCommandHost = {
  state(sections: readonly AppStateSection[], paneId: string | undefined, callerPaneId: string | null): Record<string, unknown>
  selectedPaneId(): string
  newChat(): Promise<{ paneId: string }>
  sendMessage(request: AppSendRequest): Promise<AppSendResult>
  stopAgent(paneId: string): Promise<void>
  openChat(request: AppOpenChatRequest): Promise<{ paneId: string; threadId: string | null }>
  closeChat(paneId: string): Promise<void>
  selectModel(paneId: string, modelId: string, effort: string | undefined): Promise<void>
  browserTab(request: AppBrowserTabRequest): Promise<unknown>
}

/** The slice of the chat workspace the command host needs; ChatPeerManager satisfies it. */
export type AppChatWorkspace = {
  snapshot(): ChatWorkspaceSnapshot
  paneSnapshot(paneId: string): ChatSnapshot | null
  newPeer(): Promise<string>
  send(paneId: string, text: string, attachments: ChatAttachment[]): Promise<void>
  interrupt(paneId: string): Promise<void>
  selectPane(paneId: string): Promise<void>
  openThread(paneId: string, threadId: string): Promise<void>
  closePeer(paneId: string): Promise<void>
  selectModel(paneId: string, modelId: string): Promise<void>
  selectReasoningEffort(paneId: string, effort: string): Promise<void>
  listThreads(): Promise<ChatThreadSummary[]>
  on(event: 'event', listener: (event: ChatWorkspaceEvent) => void): unknown
  off(event: 'event', listener: (event: ChatWorkspaceEvent) => void): unknown
}

export type AppBrowserTabs = {
  tabList(): BrowserTabInfo[]
  snapshot(): BrowserState
  newTab(): void
  openNewTab(input: string, activate?: boolean): void
  selectTab(id: string): void
  closeTab(id: string): void
  back(): void
  forward(): void
  reload(): void
}

export type AppDownloadList = { list(): BrowserDownload[] }

export type AppWindowInfo = {
  isFocused(): boolean
  isVisible(): boolean
  isMaximized(): boolean
  getBounds(): { x: number; y: number; width: number; height: number }
}

export type { ChatPeerSummary }

export function requireHost<T>(provider: () => T | null, what: string): T {
  const host = provider()
  if (!host) throw new Error(`ClosedAI ${what} is not available yet`)
  return host
}
