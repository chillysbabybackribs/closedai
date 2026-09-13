import { useCallback, useEffect, useRef, useState } from 'react'
import type { StreamEvent } from '../protocol/stream-types.js'
import { consumeSSEStream } from '../protocol/stream-parser.js'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning?: string
  status: 'idle' | 'streaming' | 'complete' | 'error'
  error?: string
  createdAt: number
}

export interface UseStreamingChatOptions {
  /** The backend streaming endpoint URL */
  endpointUrl: string
  /** Active agent ID or name */
  agentId?: string
  /** Conversation thread ID for persistent memory */
  threadId?: string
  /** Initial messages to populate the chat */
  initialMessages?: ChatMessage[]
  /** Callback fired on each completed turn */
  onFinish?: (message: ChatMessage) => void
  /** Callback fired on error */
  onError?: (error: Error) => void
}

export function useStreamingChat({
  endpointUrl,
  agentId = 'agentic_chat',
  threadId,
  initialMessages = [],
  onFinish,
  onError
}: UseStreamingChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [isStreaming, setIsStreaming] = useState(false)
  const [activeError, setActiveError] = useState<string | null>(null)

  // References for stream lifecycle, abort controller, and RAF batching
  const abortControllerRef = useRef<AbortController | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const pendingContentRef = useRef<string>('')
  const pendingReasoningRef = useRef<string>('')
  const activeMessageIdRef = useRef<string | null>(null)

  // Flush batched text deltas to React state on animation frame
  const flushBatch = useCallback(() => {
    rafIdRef.current = null
    const activeId = activeMessageIdRef.current
    if (!activeId) return

    const deltaContent = pendingContentRef.current
    const deltaReasoning = pendingReasoningRef.current

    if (deltaContent.length === 0 && deltaReasoning.length === 0) return

    pendingContentRef.current = ''
    pendingReasoningRef.current = ''

    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== activeId) return msg
        return {
          ...msg,
          content: msg.content + deltaContent,
          reasoning: deltaReasoning ? (msg.reasoning || '') + deltaReasoning : msg.reasoning
        }
      })
    )
  }, [])

  const scheduleBatchFlush = useCallback(() => {
    if (rafIdRef.current === null && typeof window !== 'undefined') {
      rafIdRef.current = window.requestAnimationFrame(flushBatch)
    }
  }, [flushBatch])

  // Stop active streaming generation
  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    if (rafIdRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }

    // Flush any leftover deltas
    flushBatch()

    const activeId = activeMessageIdRef.current
    if (activeId) {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === activeId ? { ...msg, status: 'complete' } : msg))
      )
      activeMessageIdRef.current = null
    }

    setIsStreaming(false)
  }, [flushBatch])

  // Send a new prompt to the streaming agent
  const sendMessage = useCallback(
    async (userInput: string) => {
      const trimmed = userInput.trim()
      if (!trimmed || isStreaming) return

      setActiveError(null)

      const userMsgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const assistantMsgId = `asst-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

      const userMessage: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content: trimmed,
        status: 'complete',
        createdAt: Date.now()
      }

      const assistantMessage: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        status: 'streaming',
        createdAt: Date.now()
      }

      setMessages((prev) => [...prev, userMessage, assistantMessage])
      setIsStreaming(true)

      activeMessageIdRef.current = assistantMsgId
      pendingContentRef.current = ''
      pendingReasoningRef.current = ''

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      try {
        const response = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream'
          },
          body: JSON.stringify({
            agentId,
            threadId,
            message: trimmed,
            history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content }))
          }),
          signal: abortController.signal
        })

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '')
          throw new Error(`Server returned HTTP ${response.status}: ${errorBody || response.statusText}`)
        }

        if (!response.body) {
          throw new Error('Response body is empty or not streamable')
        }

        for await (const event of consumeSSEStream(response.body, abortController.signal)) {
          switch (event.type) {
            case 'text-delta':
              pendingContentRef.current += event.delta
              scheduleBatchFlush()
              break

            case 'reasoning-delta':
              pendingReasoningRef.current += event.delta
              scheduleBatchFlush()
              break

            case 'error':
              throw new Error(event.message || 'Stream received an error event')

            case 'done':
              // Completion marker
              break
          }
        }

        // Final flush after stream ends
        flushBatch()

        setMessages((prev) => {
          const updated = prev.map((msg) =>
            msg.id === assistantMsgId ? { ...msg, status: 'complete' as const } : msg
          )
          const finalized = updated.find((m) => m.id === assistantMsgId)
          if (finalized) onFinish?.(finalized)
          return updated
        })
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // User aborted intentionally
          return
        }

        const errorMessage = err instanceof Error ? err.message : 'Unknown streaming error'
        setActiveError(errorMessage)
        onError?.(err instanceof Error ? err : new Error(errorMessage))

        flushBatch()
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? { ...msg, status: 'error' as const, error: errorMessage }
              : msg
          )
        )
      } finally {
        setIsStreaming(false)
        activeMessageIdRef.current = null
        abortControllerRef.current = null
      }
    },
    [agentId, endpointUrl, flushBatch, isStreaming, messages, onError, onFinish, scheduleBatchFlush, threadId]
  )

  // Retry last failed user turn
  const retryLast = useCallback(() => {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
    if (lastUserMessage) {
      // Remove any failed trailing assistant message
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last && last.role === 'assistant' && last.status === 'error') {
          return prev.slice(0, -1)
        }
        return prev
      })
      sendMessage(lastUserMessage.content)
    }
  }, [messages, sendMessage])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort()
      if (rafIdRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafIdRef.current)
      }
    }
  }, [])

  return {
    messages,
    isStreaming,
    activeError,
    sendMessage,
    stopStreaming,
    retryLast
  }
}
