import type { ChatAttachment, ChatHistoryPage, ChatHistoryWindow, ChatProvider, ChatThreadSummary } from '../../shared/chat.js'
import type { ProviderOnboardingStatus } from '../../shared/provider-onboarding.js'
import type { ChatContinuationSource, ChatNewPeerOptions, ChatPaneId, ChatRowSummary, ChatWorkspaceEvent, ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import type { DeferredProjectSwitch } from './deferred-project-switch.js'

export type ChatWorkspaceSelection = {
  cwd: string
  projectPath: string | null
}

export type ChatWorkspaceSelector = {
  current(): ChatWorkspaceSelection
  select(projectPath: string | null, preference: { modelId: string | null; reasoningEffort: string | null }): Promise<void>
}

export interface ChatWorkspaceSurface {
  readonly projectSwitch: DeferredProjectSwitch
  snapshot(window?: ChatHistoryWindow): ChatWorkspaceSnapshot
  readHistoryPage(paneId: ChatPaneId, threadId: string | null, beforeItemId: string): Promise<ChatHistoryPage>
  start(): Promise<void>
  stop(): void
  send(paneId: ChatPaneId, text: string, attachments: ChatAttachment[]): Promise<void>
  interrupt(paneId: ChatPaneId): Promise<void>
  selectPane(paneId: ChatPaneId): Promise<void>
  setVisiblePanes(cwd: string, paneIds: ChatPaneId[], retainedTabIds?: ChatPaneId[], windowId?: string): Promise<void>
  releaseWindow(windowId: string): void
  selectModel(paneId: ChatPaneId, modelId: string): Promise<void>
  selectReasoningEffort(paneId: ChatPaneId, effort: string): Promise<void>
  refreshPlanUsage(paneId: ChatPaneId, onlyIfAwake?: boolean): Promise<void>
  /** The workspace's chats now, from the store; provider catalogs are reconciled in the background. */
  listChats(): Promise<ChatRowSummary[]>
  /** Every thread the providers and the store know, reconciled first; for tools that search by title. */
  listThreads(): Promise<ChatThreadSummary[]>
  /**
   * When `anchorPaneId` is set, inherit that chat's model and workspace without focusing it first.
   * `select: false` leaves the selection alone; the caller reports the new chat visible itself.
   */
  newPeer(anchorPaneId?: ChatPaneId, options?: ChatNewPeerOptions): Promise<ChatPaneId>
  tagQuickChatSurface(paneId: ChatPaneId, surface: import('../../shared/quick-chat-overlay.js').QuickChatSurface): void
  closePeer(paneId: ChatPaneId): Promise<void>
  continueInNewPeer(source: ChatContinuationSource, modelId: string | null): Promise<ChatPaneId>
  /** Show a chat: select it if attached, else attach it, replacing the selected chat only when that one is blank. */
  openChat(chatId: string): Promise<ChatPaneId>
  openThread(paneId: ChatPaneId, threadId: string): Promise<void>
  /** Hide a chat now; its provider thread is archived after a short undo window. */
  archiveChat(chatId: string): Promise<void>
  /** Restore a chat whose provider archive has not committed yet. */
  unarchiveChat(chatId: string): Promise<void>
  setChatPinned(chatId: string, pinned: boolean): Promise<void>
  renameChat(chatId: string, title: string | null): Promise<void>
  retryChatTitle(chatId: string): Promise<void>
  archiveThread(threadId: string): Promise<void>
  compactConversation(paneId: ChatPaneId): Promise<void>
  selectProject(projectPath: string | null): Promise<void>
  selectChatProject(paneId: ChatPaneId, projectPath: string | null): Promise<void>
  beginLogin(): Promise<string | null>
  probeProviderOnboarding(): Promise<ProviderOnboardingStatus[]>
  beginProviderLogin(provider: ChatProvider): Promise<string | null>
  on(event: 'event', listener: (event: ChatWorkspaceEvent) => void): unknown
}
