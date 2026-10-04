import type { JSX } from 'react'
import { Button } from '../../components/ui/button.js'
import type { ChatSearchHit } from './history-search.js'
import { ChatHistoryThreadRow, ChatHistoryThreadRowLive } from './chat-history-thread-row.js'
import { HISTORY_PAGE_SIZE, nextHistoryPage } from './chat-history-page.js'
import type { ChatReviewQueue } from './review-queue.js'

export type ChatHistoryThreadListProps = {
  hits: ChatSearchHit[]
  activeChatId: string | null
  busy?: boolean
  pendingId?: string | null
  reviewQueue?: ChatReviewQueue
  onOpen: (chatId: string) => void
  onArchive: (chatId: string) => void
  shown: number
  onShowMore: () => void
  /** Header search palette: keyboard grid and compact chrome. */
  palette?: {
    listId: string
    optionId: (index: number) => string
    cursor: number
    setHighlightId: (id: string) => void
    busy: boolean
    visible: ChatSearchHit[]
    openDeskCount: number
  }
}

function paletteSearchRow(hit: ChatSearchHit, index: number, palette: NonNullable<ChatHistoryThreadListProps['palette']>, props: Pick<ChatHistoryThreadListProps, 'activeChatId' | 'busy' | 'pendingId' | 'reviewQueue' | 'onOpen' | 'onArchive'>, desk: boolean): JSX.Element {
  const selected = index === palette.cursor
  const rowProps = {
    hit,
    activeChatId: props.activeChatId,
    busy: props.busy ?? false,
    pending: props.pendingId === hit.row.paneId,
    onOpen: () => props.onOpen(hit.row.paneId),
    onArchive: () => props.onArchive(hit.row.paneId),
    archiveUi: 'titlebar.chat-search-delete' as const,
    palette: {
      id: palette.optionId(index),
      selected,
      onHover: () => palette.setHighlightId(hit.row.paneId),
      openUi: 'titlebar.chat-search-result' as const
    }
  }
  return (
    <li
      key={hit.row.paneId}
      id={palette.optionId(index)}
      role="row"
      aria-selected={selected}
      className="chat-history-row header-chat-search-history-row"
      data-current={hit.row.paneId === props.activeChatId || undefined}
      data-pending={props.pendingId === hit.row.paneId || undefined}
      data-desk={desk || undefined}
      onMouseEnter={() => palette.setHighlightId(hit.row.paneId)}
    >
      {desk && props.reviewQueue
        ? <ChatHistoryThreadRowLive {...rowProps} reviewQueue={props.reviewQueue} />
        : <ChatHistoryThreadRow {...rowProps} />}
    </li>
  )
}

export function ChatHistoryThreadList({
  hits,
  activeChatId,
  busy = false,
  pendingId = null,
  reviewQueue,
  onOpen,
  onArchive,
  shown,
  onShowMore,
  palette
}: ChatHistoryThreadListProps): JSX.Element {
  const visible = hits.slice(0, shown)
  const remaining = hits.length - visible.length

  if (palette) {
    const openCount = palette.openDeskCount
    const openHits = palette.visible.slice(0, openCount)
    const historyHits = palette.visible.slice(openCount)
    const historyRemaining = hits.length - openCount - historyHits.length
    return <>
      <ul id={palette.listId} role="grid" aria-label="Chat history" aria-busy={palette.busy}
        className="chat-history-list header-chat-search-history-list">
        {openCount > 0 && <>
          <li role="presentation" className="header-chat-search-caption">Open on desk</li>
          {openHits.map((hit, offset) => paletteSearchRow(hit, offset, palette,
            { activeChatId, busy, pendingId, reviewQueue, onOpen, onArchive }, true))}
        </>}
        {historyHits.length > 0 && <>
          {openCount > 0 && <li role="presentation" className="header-chat-search-caption">History</li>}
          {historyHits.map((hit, offset) => paletteSearchRow(hit, openCount + offset, palette,
            { activeChatId, busy, pendingId, reviewQueue, onOpen, onArchive }, false))}
        </>}
      </ul>
      {historyRemaining > 0 && (
        <div className="chat-history-more header-chat-search-more">
          <Button type="button" variant="ghost" size="sm" data-ui="titlebar.chat-search-more"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onShowMore}>
            Show {Math.min(HISTORY_PAGE_SIZE, historyRemaining)} more · {historyRemaining} older
          </Button>
        </div>
      )}
    </>
  }

  return (
    <ul className="chat-history-list">
      {visible.map((hit) => (
        <li
          key={hit.row.paneId}
          className="chat-history-row"
          data-current={hit.row.paneId === activeChatId || undefined}
          data-pending={pendingId === hit.row.paneId || undefined}
        >
          <ChatHistoryThreadRow
            hit={hit}
            activeChatId={activeChatId}
            busy={busy}
            pending={pendingId === hit.row.paneId}
            onOpen={() => onOpen(hit.row.paneId)}
            onArchive={() => onArchive(hit.row.paneId)}
          />
        </li>
      ))}
      {remaining > 0 && (
        <li className="chat-history-more">
          <Button type="button" variant="ghost" size="sm" data-ui="chat.history-more" onClick={onShowMore}>
            Show {Math.min(HISTORY_PAGE_SIZE, remaining)} more · {remaining} older
          </Button>
        </li>
      )}
    </ul>
  )
}

export { nextHistoryPage, HISTORY_PAGE_SIZE }
