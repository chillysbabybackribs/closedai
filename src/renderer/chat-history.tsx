import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Archive, Search } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import { Loader } from '../components/ui/loader.js'
import { errorMessage } from './error-message.js'
import type { ChatRowSummary } from '../shared/chat-peers.js'
import { formatChatTime } from './chat-history/history-format.js'
import { chatHistorySurfaceLabel, ChatHistorySurfaceMark } from './chat-history/chat-history-surface-mark.js'
import { activityAt, rankChats, segmentTitle } from './chat-history/history-search.js'

export type ChatHistoryProps = {
  /** The selected chat's id; the same id names it in the store and as a pane. */
  activeChatId: string | null
  /** True while a turn is running: switching or archiving is blocked by the main process. */
  busy: boolean
  listChats: () => Promise<ChatRowSummary[]>
  /** Live workspace rows; when provided, the panel stays in step with header search deletes. */
  chats?: ChatRowSummary[]
  openChat: (chatId: string) => Promise<void>
  archiveChat: (chatId: string) => Promise<void>
  /** Escape in the search field. */
  onClose: () => void
  /** After a chat opens; defaults to `onClose`. A History view stays open behind the chosen chat. */
  onOpened?: () => void
}

/** Rows painted per page; a workspace can hold a thousand chats and painting them all was slow. */
export const HISTORY_PAGE_SIZE = 50

/** How many rows to show after asking for more: one more page, never past the end. */
export function nextHistoryPage(shown: number, total: number, pageSize = HISTORY_PAGE_SIZE): number {
  return Math.min(total, shown + pageSize)
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; threads: ChatRowSummary[] }
  | { status: 'error'; message: string }

/**
 * Every listable chat across directories, shown in a History view tab a page at a time. The rows,
 * their order, the visibility rule, the matcher, and the time shown are the same ones header
 * search uses, so the two surfaces never disagree about what history contains.
 */
export function ChatHistory({ activeChatId, busy, listChats, chats, openChat, archiveChat, onClose, onOpened }: ChatHistoryProps): JSX.Element {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [shown, setShown] = useState(HISTORY_PAGE_SIZE)

  useEffect(() => {
    if (chats) {
      setLoad({ status: 'ready', threads: chats })
      return
    }
    let active = true
    setLoad({ status: 'loading' })
    listChats()
      .then((threads) => { if (active) setLoad({ status: 'ready', threads }) })
      .catch((error: unknown) => { if (active) setLoad({ status: 'error', message: errorMessage(error) }) })
    return () => { active = false }
  }, [listChats, reloadKey, chats])

  // Live rows arrive through the workspace stream; asking once on open still lets the main process
  // adopt provider threads the store has not seen, exactly as header search does when it opens.
  const live = chats !== undefined
  useEffect(() => {
    if (!live) return
    listChats().catch(() => {})
  }, [live, listChats, reloadKey])

  const ranked = useMemo(() => load.status === 'ready' ? rankChats(load.threads, query) : [], [load, query])
  const visible = useMemo(() => ranked.slice(0, shown), [ranked, shown])
  const remaining = ranked.length - visible.length

  async function open(chatId: string): Promise<void> {
    if (busy || pendingId) return
    setPendingId(chatId)
    setActionError(null)
    try {
      await openChat(chatId)
      ;(onOpened ?? onClose)()
    } catch (error) {
      // The transcript is hidden behind this panel, so the reason has to show here.
      setActionError(`Could not open that chat: ${errorMessage(error)}`)
    } finally {
      setPendingId(null)
    }
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (!closesHistoryOnSearchEscape(event)) return
    event.preventDefault()
    onClose()
  }

  async function archive(chatId: string): Promise<void> {
    if (pendingId) return
    setPendingId(chatId)
    setActionError(null)
    try {
      await archiveChat(chatId)
      if (!chats) {
        setLoad((current) => current.status === 'ready'
          ? { status: 'ready', threads: current.threads.filter((thread) => thread.paneId !== chatId) }
          : current)
      }
    } catch (error) {
      setActionError(`Could not archive that chat: ${errorMessage(error)}`)
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section className="chat-history" aria-label="Chat history" data-ui="chat.history">
      <label className="chat-history-search">
        <Search className="size-3.5" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setShown(HISTORY_PAGE_SIZE) }}
          onKeyDown={onSearchKeyDown}
          placeholder="Search chats"
          aria-label="Search chats"
          data-ui="chat.history-search"
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
          <Button type="button" variant="secondary" size="sm" data-ui="chat.history-retry" onClick={() => setReloadKey((key) => key + 1)}>Try again</Button>
        </div>
      )}

      {load.status === 'ready' && ranked.length === 0 && (
        <div className="chat-history-status">
          <p>{load.threads.length === 0 ? 'No chats yet.' : 'No chats match your search.'}</p>
        </div>
      )}

      {load.status === 'ready' && visible.length > 0 && (
        <ul className="chat-history-list">
          {visible.map((hit) => {
            const thread = hit.row
            const current = thread.paneId === activeChatId
            return (
              <li
                key={thread.paneId}
                className="chat-history-row"
                data-current={current || undefined}
                data-pending={pendingId === thread.paneId || undefined}
              >
                <button
                  type="button"
                  className="chat-history-open"
                  data-ui="chat.history-open"
                  data-ui-key={thread.paneId}
                  onClick={() => void open(thread.paneId)}
                  disabled={busy || pendingId !== null}
                  aria-current={current ? 'true' : undefined}
                  title={chatHistorySurfaceLabel(thread.quickChatSurface) ?? undefined}
                >
                  <span className="chat-history-leading" aria-hidden="true">
                    <ChatHistorySurfaceMark surface={thread.quickChatSurface} size={16} className="chat-history-surface" />
                  </span>
                  <span className="chat-history-body">
                    <span className="chat-history-title">
                      {segmentTitle(thread.title, hit.titleRanges).map((segment, position) => segment.matched
                        ? <mark key={position}>{segment.text}</mark> : <span key={position}>{segment.text}</span>)}
                    </span>
                    <span className="chat-history-meta">
                      {hit.folder && <span className="chat-history-folder">{hit.folder}</span>}
                      <span>{current ? 'Current' : formatChatTime(activityAt(thread))}</span>
                    </span>
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="chat-history-archive"
                  data-ui="chat.history-archive"
                  data-ui-key={thread.paneId}
                  aria-label={`Archive “${thread.title}”`}
                  title="Archive"
                  disabled={pendingId !== null || (current && busy)}
                  onClick={() => void archive(thread.paneId)}
                >
                  <Archive aria-hidden="true" />
                </Button>
              </li>
            )
          })}
          {remaining > 0 && (
            <li className="chat-history-more">
              <Button type="button" variant="ghost" size="sm" data-ui="chat.history-more"
                onClick={() => setShown((current) => nextHistoryPage(current, ranked.length))}>
                Show {Math.min(HISTORY_PAGE_SIZE, remaining)} more · {remaining} older
              </Button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

/** Escape in the history search field closes the panel instead of clearing the query. */
export function closesHistoryOnSearchEscape(
  event: Pick<React.KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'nativeEvent'>
): boolean {
  if (event.nativeEvent.isComposing) return false
  if (event.key !== 'Escape') return false
  return !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
}
