import { useCallback, useEffect, useMemo, useReducer } from 'react'
import type { ChatAttachment, ChatSnapshot, ChatThreadSummary } from '../shared/chat.js'
import type { ChatContinuationSource, ChatPeerSummary, ChatWorkspaceEvent, ChatWorkspaceSnapshot } from '../shared/chat-peers.js'
import { threadOpensInPlace } from './chat-open-target.js'
import { coalesceChatWorkspaceEvents, initialChatWorkspaceState, reduceChatWorkspaceEvent } from './chat-state.js'

export type ChatController = {
  state: ChatSnapshot
  workspace: ChatWorkspaceSnapshot['workspace']
  peers: ChatPeerSummary[]
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
  listThreads: () => Promise<ChatThreadSummary[]>
  newThread: () => Promise<void>
  continueInNewThread: () => Promise<void>
  continueFromChat: (source: ChatContinuationSource, modelId: string | null) => Promise<void>
  openThread: (threadId: string) => Promise<void>
  /** Open a history thread without disturbing the selected pane: a fresh pane takes it. */
  openThreadInNewPane: (threadId: string) => Promise<void>
  archiveThread: (threadId: string) => Promise<void>
  selectPane: (paneId: string) => Promise<void>
  closePeer: (paneId: string) => Promise<void>
  loadEarlier: () => Promise<number>
}

export function useChatController(enabled = true): ChatController {
  const [workspace, dispatch] = useReducer(reduceChatWorkspaceEvent, undefined, initialChatWorkspaceState)

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
      for (const event of batch) dispatch(event)
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

  const paneId = workspace.selectedPaneId
  const send = useCallback((text: string, attachments: ChatAttachment[]) =>
    window.closedai.chat.send(paneId, text, attachments), [paneId])
  const interrupt = useCallback(() => window.closedai.chat.interrupt(paneId), [paneId])
  const interruptPane = useCallback((targetPaneId: string) => window.closedai.chat.interrupt(targetPaneId), [])
  const selectModel = useCallback((modelId: string) => window.closedai.chat.selectModel(paneId, modelId), [paneId])
  const selectReasoningEffort = useCallback((effort: string) =>
    window.closedai.chat.selectReasoningEffort(paneId, effort), [paneId])
  const refreshPlanUsage = useCallback(() => window.closedai.chat.refreshPlanUsage(paneId), [paneId])
  const loginWithChatGPT = useCallback(() => window.closedai.chat.loginWithChatGPT(), [])
  const listThreads = useCallback(() => window.closedai.chat.listThreads(), [])
  const newThread = useCallback(() => window.closedai.chat.newPeer().then(() => undefined), [])
  const continueFromChat = useCallback((source: ChatContinuationSource, modelId: string | null) =>
    window.closedai.chat.continueInNewPeer(source, modelId).then(() => undefined), [])
  const continueInNewThread = useCallback(() => continueFromChat(
    { paneId, threadId: workspace.selected.threadId },
    workspace.selected.selectedModel
  ), [continueFromChat, paneId, workspace.selected.threadId, workspace.selected.selectedModel])
  const openThreadInNewPane = useCallback((threadId: string) =>
    window.closedai.chat.newPeer().then((freshPaneId) => window.closedai.chat.openThread(freshPaneId, threadId)), [])
  // A history thread never displaces a conversation: only a blank pane takes it in place.
  const openInPlace = threadOpensInPlace(workspace.selected)
  const openThread = useCallback((threadId: string) =>
    openInPlace ? window.closedai.chat.openThread(paneId, threadId) : openThreadInNewPane(threadId),
  [paneId, openInPlace, openThreadInNewPane])
  const archiveThread = useCallback((threadId: string) => window.closedai.chat.archiveThread(threadId), [])
  const selectPane = useCallback((nextPaneId: string) => window.closedai.chat.selectPane(nextPaneId), [])
  const closePeer = useCallback((targetPaneId: string) => window.closedai.chat.closePeer(targetPaneId), [])
  const beforeItemId = workspace.selected.items[0]?.id
  const threadId = workspace.selected.threadId
  const loadEarlier = useCallback(async (): Promise<number> => {
    if (!beforeItemId) return 0
    const page = await window.closedai.chat.historyPage(paneId, threadId, beforeItemId)
    dispatch({ type: 'historyPage', paneId, threadId, beforeItemId, page })
    return page.items.length
  }, [paneId, threadId, beforeItemId])

  // Memoized because consumers put the controller itself in dependency arrays. A fresh object
  // per render turns any `[chat]`-keyed effect into a render loop: the effect sets state, the
  // re-render mints a new controller, the effect fires again. The drawer hit exactly that.
  return useMemo(() => ({
    state: workspace.selected,
    workspace: workspace.workspace,
    peers: workspace.peers,
    selectedPaneId: workspace.selectedPaneId,
    send,
    interrupt,
    interruptPane,
    selectModel,
    selectReasoningEffort,
    refreshPlanUsage,
    loginWithChatGPT,
    listThreads,
    newThread,
    continueInNewThread,
    continueFromChat,
    openThread,
    openThreadInNewPane,
    archiveThread,
    selectPane,
    closePeer,
    loadEarlier
  }), [
    workspace.selected, workspace.workspace, workspace.peers, workspace.selectedPaneId,
    send, interrupt, interruptPane, selectModel, selectReasoningEffort, refreshPlanUsage, loginWithChatGPT,
    listThreads, newThread, continueInNewThread, continueFromChat, openThread, openThreadInNewPane,
    archiveThread, selectPane, closePeer, loadEarlier
  ])
}
