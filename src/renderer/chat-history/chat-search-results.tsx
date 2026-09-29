import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react'
import { MessageSquareDashed, SearchX } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { cursorIndex } from './header-search-dismiss.js'
import { HeaderChatSearchRow } from './header-search-row.js'
import { chatSearchFooter, chatSearchView, stepHighlight, type ChatSearchHit } from './history-search.js'
import type { ChatReviewQueue } from './review-queue.js'

/** Ranked title/preview matches shown for a query; the footer reports the full count. */
const QUERY_RESULT_LIMIT = 40
const NO_CHATS: ChatRowSummary[] = []

/**
 * The ranked sections and keyboard cursor behind a chat-search palette (the title bar's and
 * Start's). The cursor is the highlighted chat's id, so a list that reorders under it (a turn
 * finishing, a refresh adopting threads) never changes which chat Enter opens. While `active` is
 * false nothing reads the view, so a closed palette costs no ranking over a large history.
 */
export function useChatSearchList(chats: ChatRowSummary[], query: string, reviews: ChatReviewQueue, active: boolean) {
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const keyboardMoveRef = useRef(false)
  const resultsRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const view = useMemo(() => chatSearchView(active ? chats : NO_CHATS, query, reviews,
    { query: QUERY_RESULT_LIMIT }), [active, chats, query, reviews])
  const hits = useMemo(() => view.sections.flatMap(section => section.hits), [view])
  const ids = useMemo(() => hits.map(hit => hit.row.paneId), [hits])
  const indexOf = useMemo(() => new Map(ids.map((id, index) => [id, index])), [ids])
  const cursor = cursorIndex(ids, highlightId)
  const optionId = (index: number): string => `${listId}-${index}`

  // Keyboard moves keep the cursor in view; hovering never scrolls, or a row scrolling under the
  // pointer would re-highlight and scroll again.
  useEffect(() => {
    if (!active || !keyboardMoveRef.current) return
    keyboardMoveRef.current = false
    resultsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, active])

  return {
    listId, resultsRef, view, hits, indexOf, cursor, optionId, setHighlightId,
    current: hits[cursor] as ChatSearchHit | undefined,
    activeDescendant: hits.length ? optionId(cursor) : undefined,
    step: (delta: 1 | -1): void => {
      keyboardMoveRef.current = true
      setHighlightId(ids[stepHighlight(cursor, delta, ids.length)] ?? null)
    }
  }
}

export type ChatSearchList = ReturnType<typeof useChatSearchList>

export function ChatSearchResults({ list, query, busy, changingTurn, onOpen, onToggleTurn, onDelete }: {
  list: ChatSearchList
  query: string
  busy: boolean
  changingTurn: string | null
  onOpen: (hit: ChatSearchHit) => void
  onToggleTurn: (hit: ChatSearchHit) => void
  onDelete: (hit: ChatSearchHit) => void
}): JSX.Element {
  const searching = query.trim() !== ''
  return <div ref={list.resultsRef} id={list.listId} role="grid" aria-label="Chat history suggestions" aria-busy={busy}
    className="header-chat-search-list">
    {list.view.sections.map(section => <div role="rowgroup" key={section.label}
      className="header-chat-search-section" aria-label={section.label}>
      <div role="row">
        <div role="columnheader" aria-colspan={2} className="header-chat-search-caption">
          {section.label}<span>{section.total > section.hits.length
            ? `${section.hits.length} of ${section.total}` : section.hits.length}</span>
        </div>
      </div>
      {section.hits.map(hit => {
        const index = list.indexOf.get(hit.row.paneId) ?? -1
        return <HeaderChatSearchRow key={hit.row.paneId} hit={hit} id={list.optionId(index)}
          selected={index === list.cursor} busy={busy} changingTurn={changingTurn === hit.row.paneId}
          searching={searching} onHover={() => list.setHighlightId(hit.row.paneId)}
          onOpen={() => onOpen(hit)} onToggleTurn={() => onToggleTurn(hit)} onDelete={() => onDelete(hit)} />
      })}
    </div>)}
    {!list.hits.length && <div className="header-chat-search-empty" role="status">
      {searching ? <SearchX size={20} aria-hidden="true" /> : <MessageSquareDashed size={20} aria-hidden="true" />}
      <strong>{searching ? 'No matching chats' : 'No previous chats'}</strong>
      <span>{searching ? `Nothing titled or saying “${query.trim()}”` : 'Chats appear here once they have a title'}</span>
    </div>}
  </div>
}

export function ChatSearchFooter({ list, searching, escape }: { list: ChatSearchList; searching: boolean; escape: string }): JSX.Element {
  return <div className="header-chat-search-footer">
    <span aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd>Navigate</span>
    <span aria-hidden="true"><kbd>↵</kbd>Open</span>
    <span aria-hidden="true"><kbd>Esc</kbd>{escape}</span>
    <span className="header-chat-search-count">{chatSearchFooter(list.hits.length, list.view.total, searching)}</span>
  </div>
}
