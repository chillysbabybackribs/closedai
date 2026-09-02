import type { FormEvent, JSX } from 'react'
import { useEffect, useState } from 'react'
import { Send, X } from 'lucide-react'
import type { OperationsRun } from './operations-data.js'

type WorkerMessage = { id: number; author: 'Worker' | 'You'; text: string }

export function WorkerChatDrawer({ run, onClose }: { run: OperationsRun; onClose: () => void }): JSX.Element {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<WorkerMessage[]>([{
    id: 1,
    author: 'Worker',
    text: 'I’m running the verification suite now. One browser lifecycle test is taking longer than expected, but it has not failed.'
  }])
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  function send(event: FormEvent): void {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setMessages((current) => [...current, { id: Date.now(), author: 'You', text }])
    setDraft('')
  }

  return (
    <>
      <button type="button" className="ops-scrim ops-scrim-top" onClick={onClose} aria-label="Close worker chat" />
      <aside className="ops-drawer ops-chat-drawer" role="dialog" aria-modal="true" aria-labelledby="worker-chat-title">
        <header>
          <div><span className="ops-eyebrow">Message worker</span><h2 id="worker-chat-title">{run.worker}</h2><p>{run.task}</p></div>
          <button type="button" className="ops-icon-button" onClick={onClose} aria-label="Close worker chat"><X size={16} /></button>
        </header>
        <div className="ops-chat-body">
          {messages.map((message) => (
            <div className="ops-worker-message" data-author={message.author} key={message.id}>
              <strong>{message.author}</strong><p>{message.text}</p>
            </div>
          ))}
          <div className="ops-chat-hint">Messages become durable instructions for this run.</div>
        </div>
        <form className="ops-chat-composer" onSubmit={send}>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Give this worker an instruction…" />
          <button type="submit" className="ops-primary-button" aria-label="Send instruction" disabled={!draft.trim()}>
            <Send size={14} fill="currentColor" />
          </button>
        </form>
      </aside>
    </>
  )
}
