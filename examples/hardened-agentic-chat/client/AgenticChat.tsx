import type { JSX } from 'react'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { repairStreamingMarkdown, sanitizeMarkdownContent } from './markdown-repair.js'
import { useStreamingChat, type ChatMessage } from './use-streaming-chat.js'

export interface AgenticChatProps {
  endpointUrl?: string
  agentId?: string
  threadId?: string
  suggestions?: Array<{ title: string; message: string }>
  className?: string
}

export const AgenticChat = memo(function AgenticChat({
  endpointUrl = '/api/chat/stream',
  agentId = 'agentic_chat',
  threadId,
  suggestions = [
    { title: 'Write a sonnet', message: 'Write a short sonnet about AI.' },
    { title: 'Tell me a joke', message: 'Tell me a one-line joke.' },
    { title: 'Is 17 prime?', message: 'Walk me through whether 17 is prime.' }
  ],
  className = ''
}: AgenticChatProps): JSX.Element {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const isUserScrolledUpRef = useRef(false)
  const inputId = useId()

  const { messages, isStreaming, activeError, sendMessage, stopStreaming, retryLast } =
    useStreamingChat({
      endpointUrl,
      agentId,
      threadId
    })

  // Check whether scroller is anchored near the bottom
  const handleScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    // If more than 48px away from bottom, the user has scrolled up intentionally
    isUserScrolledUpRef.current = distanceToBottom > 48
  }, [])

  // Auto-scroll on new streaming content if user hasn't scrolled up
  useEffect(() => {
    if (isUserScrolledUpRef.current) return
    const el = scrollerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault()
      if (!input.trim() || isStreaming) return
      sendMessage(input)
      setInput('')
      isUserScrolledUpRef.current = false
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    },
    [input, isStreaming, sendMessage]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  const handleTextareaInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    // Auto-expand textarea
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`
  }, [])

  return (
    <div
      className={`flex flex-col h-full max-w-4xl mx-auto border border-neutral-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-neutral-900 overflow-hidden shadow-sm ${className}`}
      data-testid="agentic-chat-root"
    >
      {/* Transcript Scroll Region */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4"
        tabIndex={0}
        aria-label="Chat messages"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8 space-y-6">
            <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
                Agentic Chat Assistant
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Streaming agent with resilient token batching & markdown repair.
              </p>
            </div>

            {/* Starter Suggestions */}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center max-w-md pt-2">
                {suggestions.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      sendMessage(s.message)
                      isUserScrolledUpRef.current = false
                    }}
                    className="text-xs px-3 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition"
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((msg) => (
            <MessageRow key={msg.id} message={msg} />
          ))
        )}

        {/* Streaming Error Banner */}
        {activeError && (
          <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
            <span>Stream interrupted: {activeError}</span>
            <button
              type="button"
              onClick={retryLast}
              className="px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Footer Controls & Composer */}
      <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
        <form onSubmit={handleSubmit} className="relative flex items-end gap-2">
          <label htmlFor={inputId} className="sr-only">
            Message prompt
          </label>
          <textarea
            id={inputId}
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            className="flex-1 resize-none rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-44"
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={stopStreaming}
              className="px-3 py-2 bg-neutral-700 text-white text-xs font-medium rounded-lg hover:bg-neutral-800 transition flex items-center gap-1.5"
              title="Stop generating"
            >
              <span className="w-2 h-2 bg-red-400 rounded-sm" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  )
})

const MessageRow = memo(function MessageRow({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  const { repairedText } = useMemo(() => {
    return repairStreamingMarkdown(message.content)
  }, [message.content])

  const safeContent = useMemo(() => {
    return sanitizeMarkdownContent(repairedText)
  }, [repairedText])

  return (
    <div
      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1`}
      data-testid={`message-row-${message.role}`}
    >
      <div className="text-[11px] font-medium text-neutral-400 px-1">
        {isUser ? 'You' : 'Assistant'}
      </div>

      <div
        className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 rounded-bl-sm border border-neutral-200/50 dark:border-neutral-700/50'
        }`}
      >
        {/* Reasoning / Thought Block */}
        {message.reasoning && (
          <details className="mb-2 text-xs text-neutral-500 dark:text-neutral-400 border-l-2 border-neutral-300 dark:border-neutral-600 pl-2">
            <summary className="cursor-pointer select-none font-medium opacity-80 hover:opacity-100">
              Thought process
            </summary>
            <div className="mt-1 whitespace-pre-wrap font-mono text-[11px] opacity-90">
              {message.reasoning}
            </div>
          </details>
        )}

        {/* Main Content with Blinking Streaming Cursor */}
        <div className="whitespace-pre-wrap break-words">
          {safeContent}
          {message.status === 'streaming' && (
            <span
              className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-blue-500 animate-pulse"
              aria-hidden="true"
            />
          )}
        </div>
      </div>
    </div>
  )
})
