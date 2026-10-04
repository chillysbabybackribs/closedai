import type { JSX, MouseEvent } from 'react'
import { Archive } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import type { ChatSearchHit } from './history-search.js'
import { activityAt, segmentTitle } from './history-search.js'
import { formatChatTime } from './history-format.js'
import { chatHistorySurfaceLabel, ChatHistorySurfaceMark } from './chat-history-surface-mark.js'
import type { ChatReviewQueue } from './review-queue.js'
import { usePaneTabActivity } from '../chat-layout/chat-pane-tab-activity.js'
import { TabStatusIndicator } from '../chat-layout/tab-status-indicator.js'
import type { TabActivity } from '../chat-layout/tab-activity.js'

export type ChatHistoryThreadRowProps = {
  hit: ChatSearchHit
  activeChatId: string | null
  busy?: boolean
  pending?: boolean
  reviewQueue?: ChatReviewQueue
  status?: TabActivity
  onOpen: () => void
  onArchive: () => void
  archiveUi?: 'chat.history-archive' | 'titlebar.chat-search-delete'
  /** When set, the row participates in the header search keyboard grid. */
  palette?: {
    id: string
    selected: boolean
    onHover: () => void
    openUi?: 'chat.history-open' | 'titlebar.chat-search-result'
  }
}

export function ChatHistoryThreadRowLive(props: Omit<ChatHistoryThreadRowProps, 'status'> & { reviewQueue: ChatReviewQueue }) {
  const status = usePaneTabActivity(props.hit.row.paneId, props.reviewQueue)
  return <ChatHistoryThreadRow {...props} status={status} />
}

const swallowFocus = (event: MouseEvent): void => event.preventDefault()

/**
 * One chat-history row shared by the History view and the header search dropdown so both surfaces
 * show the same title, folder, time, and archive control.
 */
export function ChatHistoryThreadRow({
  hit,
  activeChatId,
  busy = false,
  pending = false,
  status,
  onOpen,
  onArchive,
  archiveUi = 'chat.history-archive',
  palette
}: ChatHistoryThreadRowProps): JSX.Element {
  const thread = hit.row
  const current = thread.paneId === activeChatId
  const archiveDisabled = pending || (current && busy) || thread.running
  const activityLabel = status && status.state !== 'idle' ? status.label : null
  const whenLabel = current ? 'Current' : activityLabel ?? formatChatTime(activityAt(thread))
  const openBody = <>
    <span className="chat-history-leading" aria-hidden="true">
      {status && status.state !== 'idle'
        ? <TabStatusIndicator status={status} />
        : <ChatHistorySurfaceMark surface={thread.quickChatSurface} size={16} className="chat-history-surface" />}
    </span>
    <span className="chat-history-body">
      <span className="chat-history-title">
        {segmentTitle(thread.title, hit.titleRanges).map((segment, position) => segment.matched
          ? <mark key={position}>{segment.text}</mark> : <span key={position}>{segment.text}</span>)}
      </span>
      <span className="chat-history-meta">
        {hit.folder && <span className="chat-history-folder">{hit.folder}</span>}
        <span className="chat-history-when">{whenLabel}</span>
      </span>
    </span>
  </>
  const openProps = {
    type: 'button' as const,
    className: 'chat-history-open',
    'data-ui-key': thread.paneId,
    disabled: busy || pending,
    'aria-current': current ? 'true' as const : undefined,
    title: activityLabel ?? chatHistorySurfaceLabel(thread.quickChatSurface) ?? undefined,
    'aria-label': activityLabel ? `${thread.title} — ${activityLabel}` : undefined,
    tabIndex: palette ? -1 as const : undefined,
    onMouseDown: palette ? swallowFocus : undefined,
    onClick: onOpen
  }
  const openButton = palette?.openUi === 'titlebar.chat-search-result'
    ? <button {...openProps} data-ui="titlebar.chat-search-result">{openBody}</button>
    : <button {...openProps} data-ui="chat.history-open">{openBody}</button>

  const archiveProps = {
    type: 'button' as const,
    variant: 'ghost' as const,
    size: 'icon-xs' as const,
    className: 'chat-history-archive',
    'data-ui-key': thread.paneId,
    'aria-label': `Archive “${thread.title}”`,
    title: thread.running ? 'Wait for this chat to finish before archiving' : 'Archive',
    disabled: archiveDisabled,
    onMouseDown: palette ? swallowFocus : undefined,
    onClick: onArchive,
    children: <Archive aria-hidden="true" />
  }
  const archiveButton = archiveUi === 'titlebar.chat-search-delete'
    ? <Button {...archiveProps} data-ui="titlebar.chat-search-delete" />
    : <Button {...archiveProps} data-ui="chat.history-archive" />

  if (!palette) {
    return <>
      {openButton}
      {archiveButton}
    </>
  }

  return <>
    <div role="gridcell" className="header-chat-search-main">
      {openButton}
    </div>
    <div role="gridcell" className="header-chat-search-actions header-chat-search-actions-history">
      {archiveButton}
    </div>
  </>
}
