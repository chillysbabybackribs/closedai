import { startTransition, useCallback, useEffect, useMemo, useReducer, type Dispatch } from 'react'
import type { ChatAttachment, ChatSnapshot } from '../shared/chat.js'
import type { ChatContinuationSource, ChatRowSummary, ChatWorkspaceEvent, ChatWorkspaceSnapshot } from '../shared/chat-peers.js'
import { coalesceChatWorkspaceEvents, initialChatRendererState, reduceChatRendererEvent, type ChatWorkspaceAction } from './chat-state.js'

export type ChatController = {
  state: ChatSnapshot
  workspace: ChatWorkspaceSnapshot['workspace']
  /** Every chat of the workspace, attached or not; the drawer's rows. */
  chats: ChatRowSummary[]
  selectedPaneId: string
  send: (text: string, attachments: ChatAttachment[]) => Promise<void>
  interrupt: () => Promise<void>
  /** Stop one pane's turn by id, so a drawer row can stop a background chat, not the open one. */
  interruptPane: (paneId: string) => Promise<void>
  selectModel: (modelId: string) => Promise<void>
  selectReasoningEffort: (effort: string) => Promise<void>
  /** Re-read the provider's subscription usage, e.g. when the usage card opens. */
  refreshPlanUsage: () => Promise<void>
  loginWithChatGPT: () => Promise<void>
  /** The store's chats now; the main process reconciles provider catalogs behind the answer. */
  listChats: () => Promise<ChatRowSummary[]>
  newThread: () => Promise<void>
  continueInNewThread: () => Promise<void>
  continueFromChat: (source: ChatContinuationSource, modelId: string | null) => Promise<void>
  /** Show a chat by id. Main decides whether it replaces a blank selected chat or opens beside it. */
  openChat: (chatId: string) => Promise<void>
  archiveChat: (chatId: string) => Promise<void>
  setChatPinned: (chatId: string, pinned: boolean) => Promise<void>
  compactConversation: () => Promise<void>
  selectPane: (paneId: string) => Promise<void>
  closePeer: (paneId: string) => Promise<void>
  loadEarlier: () => Promise<number>
}

export function useChatController(enabled = true) {
  const [{ workspace, sidebar: sidebarState }, dispatch] = useReducer(reduceChatRendererEvent, undefined, initialChatRendererState)

  useEffect(() => {
    if (!enabled) return
    // Codex streams one event per token chunk. Queue them and apply a frame's worth at once so
    // a long transcript renders once per frame instead of once per chunk.
    let active = true
    let queue: ChatWorkspaceEvent[] = []
    let frame: number | null = null
    const flush = (): void => {
      frame = null
      const batch = coalesceChatWorkspaceEvents(queue)
      queue = []
      // Streaming token batches are non-urgent UI work; keep composer input and scrolling smooth.
      startTransition(() => {
        for (const event of batch) dispatch(event)
      })
    }
    const enqueue = (event: ChatWorkspaceEvent): void => {
      if (!active) return
      queue.push(event)
      frame ??= window.requestAnimationFrame(flush)
    }
    const unsubscribe = window.closedai.chat.onEvent(enqueue)
    void window.closedai.chat.snapshot().then((snapshot) => enqueue({ type: 'workspace', snapshot }))
    return () => {
      active = false
      if (frame !== null) window.cancelAnimationFrame(frame)
      unsubscribe()
    }
  }, [enabled])

  const selected = usePaneChatController(workspace, workspace.selectedPaneId, workspace.selected, dispatch)
  const sidebar = usePaneChatController(workspace, workspace.selectedPaneId, sidebarState, dispatch)
  return { ...selected, sidebar, snapshot: workspace, dispatch }
}

/** Bind every action to the tile's identity, independently of current keyboard focus. */
export function usePaneChatController(
  workspace: ChatWorkspaceSnapshot,
  paneId: string,
  state: ChatSnapshot,
  dispatch: Dispatch<ChatWorkspaceAction>
): ChatController {
  const send = useCallback((text: string, attachments: ChatAttachment[]) =>
    window.closedai.chat.send(paneId, text, attachments), [paneId])
  const interrupt = useCallback(() => window.closedai.chat.interrupt(paneId), [paneId])
  const interruptPane = useCallback((targetPaneId: string) => window.closedai.chat.interrupt(targetPaneId), [])
  const selectModel = useCallback((modelId: string) => window.closedai.chat.selectModel(paneId, modelId), [paneId])
  const selectReasoningEffort = useCallback((effort: string) =>
    window.closedai.chat.selectReasoningEffort(paneId, effort), [paneId])
  const refreshPlanUsage = useCallback(() => window.closedai.chat.refreshPlanUsage(paneId), [paneId])
  const loginWithChatGPT = useCallback(() => window.closedai.chat.loginWithChatGPT(), [])
  const listChats = useCallback(() => window.closedai.chat.listChats(), [])
  const newThread = useCallback(() => window.closedai.chat.newPeer().then(() => undefined), [])
  const continueFromChat = useCallback((source: ChatContinuationSource, modelId: string | null) =>
    window.closedai.chat.continueInNewPeer(source, modelId).then(() => undefined), [])
  const continueInNewThread = useCallback(() => continueFromChat(
    { paneId, threadId: state.threadId },
    state.selectedModel
  ), [continueFromChat, paneId, state.threadId, state.selectedModel])
  const openChat = useCallback((chatId: string) => window.closedai.chat.openChat(chatId).then(() => undefined), [])
  const archiveChat = useCallback((chatId: string) => window.closedai.chat.archiveChat(chatId), [])
  const setChatPinned = useCallback((chatId: string, pinned: boolean) => window.closedai.chat.setChatPinned(chatId, pinned), [])
  const compactConversation = useCallback(() => window.closedai.chat.compactConversation(paneId), [paneId])
  const selectPane = useCallback((nextPaneId: string) => window.closedai.chat.selectPane(nextPaneId), [])
  const closePeer = useCallback((targetPaneId: string) => window.closedai.chat.closePeer(targetPaneId), [])
  const beforeItemId = state.items[0]?.id
  const threadId = state.threadId
  const loadEarlier = useCallback(async (): Promise<number> => {
    if (!beforeItemId) return 0
    const page = await window.closedai.chat.historyPage(paneId, threadId, beforeItemId)
    dispatch({ type: 'historyPage', paneId, threadId, beforeItemId, page })
    return page.items.length
  }, [paneId, threadId, beforeItemId])

  // Actions stay stable across text updates, so the sidebar can use its own snapshot without
  // receiving a new controller for each streamed chunk.
  return useMemo(() => ({
    state,
    workspace: workspace.workspace,
    chats: workspace.chats,
    selectedPaneId: paneId,
    send,
    interrupt,
    interruptPane,
    selectModel,
    selectReasoningEffort,
    refreshPlanUsage,
    loginWithChatGPT,
    listChats,
    newThread,
    continueInNewThread,
    continueFromChat,
    openChat,
    archiveChat,
    setChatPinned,
    compactConversation,
    selectPane,
    closePeer,
    loadEarlier
  }), [
    state, workspace.workspace, workspace.chats, paneId,
    send, interrupt, interruptPane, selectModel, selectReasoningEffort, refreshPlanUsage, loginWithChatGPT,
    listChats, newThread, continueInNewThread, continueFromChat, openChat,
    archiveChat, setChatPinned, compactConversation, selectPane, closePeer, loadEarlier
  ])
}
