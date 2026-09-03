import { useEffect, useRef, useState } from 'react'
import { Check, Copy, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { ChatTranscriptItem } from '../shared/chat.js'

export type MessageActionContext = {
  threadKey: string
  running: boolean
  branch: (itemId: string) => Promise<void>
}
type AssistantItem = Extract<ChatTranscriptItem, { type: 'assistant' }>
type MessageMetadata = { createdAt?: number; feedback?: 'up' | 'down' }

function readMetadata(key: string): MessageMetadata {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}') as MessageMetadata | null
    return {
      createdAt: typeof value?.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : undefined,
      feedback: value?.feedback === 'up' || value?.feedback === 'down' ? value.feedback : undefined
    }
  } catch { return {} }
}

export function MessageActions({ item, context }: { item: AssistantItem; context: MessageActionContext }) {
  const storageKey = 'closedai:message:' + JSON.stringify([context.threadKey, item.id])
  const [metadata, setMetadata] = useState<MessageMetadata>(() => {
    const saved = readMetadata(storageKey)
    return { ...saved, createdAt: item.createdAt ?? saved.createdAt ?? (item.streaming ? Date.now() : undefined) }
  })
  const [copied, setCopied] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [branching, setBranching] = useState(false)
  const [error, setError] = useState('')
  const resetCopy = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (resetCopy.current) clearTimeout(resetCopy.current) }, [])
  useEffect(() => {
    if (!metadata.createdAt) return
    try { localStorage.setItem(storageKey, JSON.stringify(metadata)) } catch { /* Rating writes report errors below. */ }
  }, [metadata, storageKey])

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(item.text)
      setError('')
      setCopied(true)
      if (resetCopy.current) clearTimeout(resetCopy.current)
      resetCopy.current = setTimeout(() => setCopied(false), 2000)
    } catch { setError('Could not copy this response.') }
  }

  function rate(feedback: 'up' | 'down'): void {
    const next = { ...metadata, feedback: metadata.feedback === feedback ? undefined : feedback }
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setMetadata(next)
      setFeedbackOpen(false)
      setError('')
    } catch { setError('Could not save your feedback.') }
  }

  async function branch(): Promise<void> {
    setBranching(true)
    setError('')
    try { await context.branch(item.id) }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not branch this chat.')
    } finally { setBranching(false) }
  }

  if (item.streaming || item.phase === 'commentary') return null
  const timestamp = metadata.createdAt ? new Date(metadata.createdAt) : null
  return (
    <div className="message-actions-wrap">
      <div className="message-actions" role="group" aria-label="Response actions">
        <button type="button" data-ui="chat.message-copy" data-ui-key={item.id}
          title={copied ? 'Copied' : 'Copy'} aria-label={copied ? 'Copied' : 'Copy response'} onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
        </button>
        <div className="message-feedback" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFeedbackOpen(false)
        }} onKeyDown={(event) => { if (event.key === 'Escape') setFeedbackOpen(false) }}>
          <button type="button" data-ui="chat.message-feedback" data-ui-key={item.id}
            aria-label="Rate response" title="Rate response" aria-expanded={feedbackOpen}
            className={metadata.feedback ? 'is-rated' : undefined}
            onClick={() => setFeedbackOpen((open) => !open)}>
            {metadata.feedback === 'up' ? <ThumbsUp /> : metadata.feedback === 'down' ? <ThumbsDown /> : (
              <span className="message-feedback-icon"><ThumbsUp /><ThumbsDown /></span>
            )}
          </button>
          {feedbackOpen ? (
            <div className="message-feedback-options" role="group" aria-label="Save feedback locally">
              <button type="button" data-ui="chat.message-like" data-ui-key={item.id}
                aria-label="Good response" title="Good response (saved locally)" aria-pressed={metadata.feedback === 'up'}
                onClick={() => rate('up')}><ThumbsUp /></button>
              <button type="button" data-ui="chat.message-dislike" data-ui-key={item.id}
                aria-label="Bad response" title="Bad response (saved locally)" aria-pressed={metadata.feedback === 'down'}
                onClick={() => rate('down')}><ThumbsDown /></button>
            </div>
          ) : null}
        </div>
        <button type="button" data-ui="chat.message-branch" data-ui-key={item.id}
          title={context.running ? 'Wait for the current turn to finish' : 'Branch in new chat'}
          aria-label="Branch in new chat" disabled={context.running || branching} onClick={() => void branch()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12h6l10-10M12 2h8v8M13 15v7h7" />
          </svg>
        </button>
        {timestamp ? <time className="message-timestamp" dateTime={timestamp.toISOString()} title={timestamp.toLocaleString()}>
          {timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </time> : null}
        <span className="sr-only" role="status">{copied ? 'Response copied' : ''}</span>
      </div>
      {error ? <span className="message-action-error" role="alert">{error}</span> : null}
    </div>
  )
}
