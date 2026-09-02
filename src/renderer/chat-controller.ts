import { useCallback, useEffect, useReducer } from 'react'
import type { ChatAttachment, ChatEvent, ChatSnapshot, ChatThreadSummary } from '../shared/chat.js'
import { coalesceChatEvents, initialChatState, reduceChatEvent } from './chat-state.js'

export type ChatController = {
  state: ChatSnapshot
  send: (text: string, attachments: ChatAttachment[]) => Promise<void>
  interrupt: () => Promise<void>
  selectModel: (modelId: string) => Promise<void>
  loginWithChatGPT: () => Promise<void>
  listThreads: () => Promise<ChatThreadSummary[]>
  newThread: () => Promise<void>
  openThread: (threadId: string) => Promise<void>
  archiveThread: (threadId: string) => Promise<void>
}

export function useChatController(): ChatController {
  const [state, dispatch] = useReducer(reduceChatEvent, undefined, initialChatState)

  useEffect(() => {
    // Codex streams one event per token chunk. Queue them and apply a frame's worth at once so
    // a long transcript renders once per frame instead of once per chunk.
    let active = true
    let queue: ChatEvent[] = []
    let frame: number | null = null
    const flush = (): void => {
      frame = null
      const batch = coalesceChatEvents(queue)
      queue = []
      for (const event of batch) dispatch(event)
    }
    const enqueue = (event: ChatEvent): void => {
      if (!active) return
      queue.push(event)
      frame ??= window.requestAnimationFrame(flush)
    }
    const unsubscribe = window.closedai.chat.onEvent(enqueue)
    void window.closedai.chat.snapshot().then((snapshot) => enqueue({ type: 'replace', snapshot }))
    return () => {
      active = false
      if (frame !== null) window.cancelAnimationFrame(frame)
      unsubscribe()
    }
  }, [])

  const send = useCallback((text: string, attachments: ChatAttachment[]) => window.closedai.chat.send(text, attachments), [])
  const interrupt = useCallback(() => window.closedai.chat.interrupt(), [])
  const selectModel = useCallback((modelId: string) => window.closedai.chat.selectModel(modelId), [])
  const loginWithChatGPT = useCallback(() => window.closedai.chat.loginWithChatGPT(), [])
  const listThreads = useCallback(() => window.closedai.chat.listThreads(), [])
  const newThread = useCallback(() => window.closedai.chat.newThread(), [])
  const openThread = useCallback((threadId: string) => window.closedai.chat.openThread(threadId), [])
  const archiveThread = useCallback((threadId: string) => window.closedai.chat.archiveThread(threadId), [])

  return { state, send, interrupt, selectModel, loginWithChatGPT, listThreads, newThread, openThread, archiveThread }
}
