import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { ChatTranscriptItem } from '../shared/chat.js'

export type MessageActionContext = {
  threadKey: string
  running: boolean
  branch: (itemId: string) => Promise<void>
}
type AssistantItem = Extract<ChatTranscriptItem, { type: 'assistant' }>
type MessageMetadata = { createdAt?: number }

function readMetadata(key: string): MessageMetadata {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}') as MessageMetadata | null
    return {
      createdAt: typeof value?.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : undefined
    }
  } catch { return {} }
}

export function MessageActions({ item, context }: { item: AssistantItem; context: MessageActionContext }) {
  const storageKey = 'closedai:message:' + JSON.stringify([context.threadKey, item.id])
  const [metadata] = useState<MessageMetadata>(() => {
    const saved = readMetadata(storageKey)
    return { ...saved, createdAt: item.createdAt ?? saved.createdAt ?? (item.streaming ? Date.now() : undefined) }
  })
  const [copied, setCopied] = useState(false)
  const [branching, setBranching] = useState(false)
  const [error, setError] = useState('')
  const resetCopy = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (resetCopy.current) clearTimeout(resetCopy.current) }, [])
  useEffect(() => {
    if (!metadata.createdAt) return
    try { localStorage.setItem(storageKey, JSON.stringify(metadata)) } catch { /* Timestamps are a nicety; losing one is not worth an error. */ }
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
