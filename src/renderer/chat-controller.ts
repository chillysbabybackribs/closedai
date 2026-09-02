import { useCallback, useEffect, useReducer } from 'react'
import type { ChatApprovalDecision, ChatAttachment, ChatSnapshot, ChatThreadSummary } from '../shared/chat.js'
import { initialChatState, reduceChatEvent } from './chat-state.js'

export type ChatController = {
  state: ChatSnapshot
  send: (text: string, attachments: ChatAttachment[]) => Promise<void>
  interrupt: () => Promise<void>
  selectModel: (modelId: string) => Promise<void>
  respondToApproval: (requestId: string, decision: ChatApprovalDecision) => Promise<void>
  loginWithChatGPT: () => Promise<void>
  listThreads: () => Promise<ChatThreadSummary[]>
  newThread: () => Promise<void>
  openThread: (threadId: string) => Promise<void>
  archiveThread: (threadId: string) => Promise<void>
}

export function useChatController(): ChatController {
  const [state, dispatch] = useReducer(reduceChatEvent, undefined, initialChatState)

  useEffect(() => {
    let active = true
    const unsubscribe = window.closedai.chat.onEvent((event) => {
      if (active) dispatch(event)
    })
    void window.closedai.chat.snapshot().then((snapshot) => {
      if (active) dispatch({ type: 'replace', snapshot })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const send = useCallback((text: string, attachments: ChatAttachment[]) => window.closedai.chat.send(text, attachments), [])
  const interrupt = useCallback(() => window.closedai.chat.interrupt(), [])
  const selectModel = useCallback((modelId: string) => window.closedai.chat.selectModel(modelId), [])
  const respondToApproval = useCallback(
    (requestId: string, decision: ChatApprovalDecision) => window.closedai.chat.respondToApproval(requestId, decision),
    []
  )
  const loginWithChatGPT = useCallback(() => window.closedai.chat.loginWithChatGPT(), [])
  const listThreads = useCallback(() => window.closedai.chat.listThreads(), [])
  const newThread = useCallback(() => window.closedai.chat.newThread(), [])
  const openThread = useCallback((threadId: string) => window.closedai.chat.openThread(threadId), [])
  const archiveThread = useCallback((threadId: string) => window.closedai.chat.archiveThread(threadId), [])

  return { state, send, interrupt, selectModel, respondToApproval, loginWithChatGPT, listThreads, newThread, openThread, archiveThread }
}
