import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react'
import { MessageSquareDashed, SearchX } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { cursorIndex } from './header-search-dismiss.js'
import { ChatHistoryThreadList, HISTORY_PAGE_SIZE, nextHistoryPage } from './chat-history-thread-list.js'
import { openDeskSearchHits, rankChatsExcluding, stepHighlight, type ChatSearchHit } from './history-search.js'
import type { ChatReviewQueue } from './review-queue.js'

const NO_CHATS: ChatRowSummary[] = []

/**
 * Ranked chat list and keyboard cursor for the header search palette. Uses the same flat
 * `rankChats` order and paging as the History view.
 */
export function useChatSearchList(
  chats: ChatRowSummary[],
  query: string,
  active: boolean,
  openDeskChatIds: readonly string[] = []
) {
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [shown, setShown] = useState(HISTORY_PAGE_SIZE)
  const keyboardMoveRef = useRef(false)
  const resultsRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    setShown(HISTORY_PAGE_SIZE)
    setHighlightId(null)
  }, [query])

  const openDesk = useMemo(
    () => (active ? openDeskSearchHits(chats, openDeskChatIds, query) : []),
    [active, chats, openDeskChatIds, query]
  )
  const openDeskSet = useMemo(() => new Set(openDesk.map((hit) => hit.row.paneId)), [openDesk])
  const ranked = useMemo(
    () => rankChatsExcluding(active ? chats : NO_CHATS, query, openDeskSet),
    [active, chats, query, openDeskSet]
  )
  const visibleHistory = useMemo(() => ranked.slice(0, shown), [ranked, shown])
  const visible = useMemo(() => [...openDesk, ...visibleHistory], [openDesk, visibleHistory])
  const ids = useMemo(() => visible.map(hit => hit.row.paneId), [visible])
  const indexOf = useMemo(() => new Map(ids.map((id, index) => [id, index])), [ids])
  const cursor = cursorIndex(ids, highlightId)
  const optionId = (index: number): string => `${listId}-${index}`

  useEffect(() => {
    if (!active || !keyboardMoveRef.current) return
    keyboardMoveRef.current = false
    resultsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, active])

  return {
    listId,
    resultsRef,
    ranked,
    openDesk,
    visibleHistory,
    visible,
    shown,
    setShown,
    indexOf,
    cursor,
    optionId,
    setHighlightId,
    current: visible[cursor] as ChatSearchHit | undefined,
    activeDescendant: visible.length ? optionId(cursor) : undefined,
    step: (delta: 1 | -1): void => {
      keyboardMoveRef.current = true
      setHighlightId(ids[stepHighlight(cursor, delta, ids.length)] ?? null)
    }
  }
}

export type ChatSearchList = ReturnType<typeof useChatSearchList>

function hitByPaneId(hits: ChatSearchHit[], chatId: string): ChatSearchHit | undefined {
  return hits.find((entry) => entry.row.paneId === chatId)
}

export function ChatSearchResults({ list, query, busy, pendingId, activeChatId, reviewQueue, onOpen, onArchive }: {
  list: ChatSearchList
  query: string
  busy: boolean
  pendingId: string | null
  activeChatId: string | null
  reviewQueue?: ChatReviewQueue
  onOpen: (hit: ChatSearchHit) => void
  onArchive: (hit: ChatSearchHit) => void
}): JSX.Element {
  const searching = query.trim() !== ''
  const allHits = useMemo(() => [...list.openDesk, ...list.ranked], [list.openDesk, list.ranked])

  return <div ref={list.resultsRef} className="header-chat-search-list">
    {list.visible.length > 0
      ? <ChatHistoryThreadList
          hits={allHits}
          activeChatId={activeChatId}
          busy={busy}
          pendingId={pendingId}
          reviewQueue={reviewQueue}
          shown={list.shown}
          onShowMore={() => list.setShown((current) => nextHistoryPage(current, list.ranked.length))}
          onOpen={(chatId) => {
            const hit = hitByPaneId(allHits, chatId)
            if (hit) onOpen(hit)
          }}
          onArchive={(chatId) => {
            const hit = hitByPaneId(allHits, chatId)
            if (hit) onArchive(hit)
          }}
          palette={{
            listId: list.listId,
            optionId: list.optionId,
            cursor: list.cursor,
            setHighlightId: list.setHighlightId,
            busy,
            visible: list.visible,
            openDeskCount: list.openDesk.length
          }}
        />
      : <div className="header-chat-search-empty" role="status">
          {searching ? <SearchX size={20} aria-hidden="true" /> : <MessageSquareDashed size={20} aria-hidden="true" />}
          <strong>{searching ? 'No chats match your search.' : 'No chats yet.'}</strong>
          <span>{searching ? 'Try another title, preview, or project folder name.' : 'Chats appear here once they have a title.'}</span>
        </div>}
  </div>
}

export function ChatSearchFooter({ escape }: { escape: string }): JSX.Element {
  return <div className="header-chat-search-footer">
    <span aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd>Navigate</span>
    <span aria-hidden="true"><kbd>↵</kbd>Open</span>
    <span aria-hidden="true"><kbd>Esc</kbd>{escape}</span>
  </div>
}
