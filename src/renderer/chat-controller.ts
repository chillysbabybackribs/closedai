import { useCallback, useEffect, useReducer } from 'react'
import type { ChatAttachment, ChatSnapshot, ChatThreadSummary } from '../shared/chat.js'
import type { ChatPeerSummary, ChatWorkspaceEvent } from '../shared/chat-peers.js'
import { initialChatWorkspaceState, reduceChatWorkspaceEvent } from './chat-state.js'

export type ChatController = {
  state: ChatSnapshot
  peers: ChatPeerSummary[]
  selectedPaneId: string
  send: (text: string, attachments: ChatAttachment[]) => Promise<void>
  interrupt: () => Promise<void>
  selectModel: (modelId: string) => Promise<void>
  selectReasoningEffort: (effort: string) => Promise<void>
  loginWithChatGPT: () => Promise<void>
  listThreads: () => Promise<ChatThreadSummary[]>
  newThread: () => Promise<void>
  continueInNewThread: () => Promise<void>
  openThread: (threadId: string) => Promise<void>
  archiveThread: (threadId: string) => Promise<void>
  selectPane: (paneId: string) => Promise<void>
  closePeer: (paneId: string) => Promise<void>
}

export function useChatController(): ChatController {
  const [workspace, dispatch] = useReducer(reduceChatWorkspaceEvent, undefined, initialChatWorkspaceState)

  useEffect(() => {
    // Codex streams one event per token chunk. Queue them and apply a frame's worth at once so
    // a long transcript renders once per frame instead of once per chunk.
    let active = true
    let queue: ChatWorkspaceEvent[] = []
    let frame: number | null = null
    const flush = (): void => {
      frame = null
      const batch = queue
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
  }, [])

  const paneId = workspace.selectedPaneId
  const send = useCallback((text: string, attachments: ChatAttachment[]) =>
    window.closedai.chat.send(paneId, text, attachments), [paneId])
  const interrupt = useCallback(() => window.closedai.chat.interrupt(paneId), [paneId])
  const selectModel = useCallback((modelId: string) => window.closedai.chat.selectModel(paneId, modelId), [paneId])
  const selectReasoningEffort = useCallback((effort: string) =>
    window.closedai.chat.selectReasoningEffort(paneId, effort), [paneId])
  const loginWithChatGPT = useCallback(() => window.closedai.chat.loginWithChatGPT(), [])
  const listThreads = useCallback(() => window.closedai.chat.listThreads(), [])
  const newThread = useCallback(() => window.closedai.chat.newPeer().then(() => undefined), [])
  const continueInNewThread = useCallback(() => window.closedai.chat.continueInNewPeer(paneId).then(() => undefined), [paneId])
  const openThread = useCallback((threadId: string) => window.closedai.chat.openThread(paneId, threadId), [paneId])
  const archiveThread = useCallback((threadId: string) => window.closedai.chat.archiveThread(threadId), [])
  const selectPane = useCallback((nextPaneId: string) => window.closedai.chat.selectPane(nextPaneId), [])
  const closePeer = useCallback((targetPaneId: string) => window.closedai.chat.closePeer(targetPaneId), [])

  return {
    state: workspace.selected,
    peers: workspace.peers,
    selectedPaneId: workspace.selectedPaneId,
    send,
    interrupt,
    selectModel,
    selectReasoningEffort,
    loginWithChatGPT,
    listThreads,
    newThread,
    continueInNewThread,
    openThread,
    archiveThread,
    selectPane,
    closePeer
  }
}
