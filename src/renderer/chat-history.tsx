import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Archive, Search } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import { Loader } from '../components/ui/loader.js'
import type { ChatThreadSummary } from '../shared/chat.js'

export type ChatHistoryProps = {
  activeThreadId: string | null
  /** True while a turn is running: switching or archiving is blocked by the main process. */
  busy: boolean
  listThreads: () => Promise<ChatThreadSummary[]>
  openThread: (threadId: string) => Promise<void>
  archiveThread: (threadId: string) => Promise<void>
  onClose: () => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; threads: ChatThreadSummary[] }
  | { status: 'error'; message: string }

/** In-pane list of past chats for this workspace. Replaces the transcript while open. */
export function ChatHistory({ activeThreadId, busy, listThreads, openThread, archiveThread, onClose }: ChatHistoryProps): JSX.Element {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    setLoad({ status: 'loading' })
    listThreads()
      .then((threads) => { if (active) setLoad({ status: 'ready', threads }) })
      .catch((error: unknown) => { if (active) setLoad({ status: 'error', message: messageOf(error) }) })
    return () => { active = false }
  }, [listThreads, reloadKey])

  const visible = useMemo(() => {
    if (load.status !== 'ready') return []
    const needle = query.trim().toLowerCase()
    if (!needle) return load.threads
    return load.threads.filter((thread) =>
      thread.title.toLowerCase().includes(needle) || thread.preview.toLowerCase().includes(needle)
    )
  }, [load, query])

  async function open(threadId: string): Promise<void> {
    if (busy || pendingId) return
    setPendingId(threadId)
    setActionError(null)
    try {
      await openThread(threadId)
      onClose()
    } catch (error) {
      // The transcript is hidden behind this panel, so the reason has to show here.
      setActionError(`Could not open that chat: ${messageOf(error)}`)
    } finally {
      setPendingId(null)
    }
  }

  async function archive(threadId: string): Promise<void> {
    if (pendingId) return
    setPendingId(threadId)
    setActionError(null)
    try {
      await archiveThread(threadId)
      setLoad((current) => current.status === 'ready'
        ? { status: 'ready', threads: current.threads.filter((thread) => thread.id !== threadId) }
        : current)
    } catch (error) {
      setActionError(`Could not archive that chat: ${messageOf(error)}`)
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section className="chat-history" aria-label="Chat history">
      <label className="chat-history-search">
        <Search className="size-3.5" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          spellCheck={false}
          autoFocus
        />
      </label>

      {actionError && <p className="chat-history-error" role="alert">{actionError}</p>}

      {load.status === 'loading' && (
        <div className="chat-history-status"><Loader variant="typing" text="Loading chats" /></div>
      )}

      {load.status === 'error' && (
        <div className="chat-history-status" role="alert">
          <p>{load.message}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>Try again</Button>
        </div>
      )}

      {load.status === 'ready' && visible.length === 0 && (
        <div className="chat-history-status">
          <p>{load.threads.length === 0 ? 'No chats yet for this workspace.' : 'No chats match your search.'}</p>
        </div>
      )}

      {load.status === 'ready' && visible.length > 0 && (
        <ul className="chat-history-list">
          {visible.map((thread) => {
            const current = thread.id === activeThreadId
            return (
              <li
                key={thread.id}
                className="chat-history-row"
                data-current={current || undefined}
                data-pending={pendingId === thread.id || undefined}
              >
                <button
                  type="button"
                  className="chat-history-open"
                  onClick={() => void open(thread.id)}
                  disabled={busy || pendingId !== null}
                  aria-current={current ? 'true' : undefined}
                >
                  <span className="chat-history-title">{thread.title}</span>
                  <span className="chat-history-meta">
                    {current ? 'Current' : formatRelativeTime(thread.updatedAt)}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="chat-history-archive"
                  aria-label={`Archive “${thread.title}”`}
                  title="Archive"
                  disabled={pendingId !== null || (current && busy)}
                  onClick={() => void archive(thread.id)}
                >
                  <Archive aria-hidden="true" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatRelativeTime(timestampMs: number, now = Date.now()): string {
  if (!timestampMs) return ''
  const elapsed = now - timestampMs
  if (elapsed < MINUTE) return 'Just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`
  const date = new Date(timestampMs)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' })
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  // Electron prefixes errors thrown by ipcMain.handle with the channel name; not useful to a reader.
  return text.replace(/^Error invoking remote method '[^']*': /, '').replace(/^\w*Error: /, '')
}
