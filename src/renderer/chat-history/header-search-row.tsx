import type { JSX, MouseEvent } from 'react'
import { LoaderCircle, Pause, Play, Trash2 } from 'lucide-react'
import { ProviderMark } from '../../components/ui/provider-mark.js'
import { formatChatTime } from './history-format.js'
import { chatHistorySurfaceLabel, ChatHistorySurfaceMark } from './chat-history-surface-mark.js'
import { chatSearchMeta, chatSearchPlace, chatSearchWhen, segmentTitle, type ChatActivityHit } from './history-search.js'

export type HeaderChatSearchRowProps = {
  hit: ChatActivityHit
  id: string
  selected: boolean
  /** Some row action is in flight; every control waits for it. */
  busy: boolean
  changingTurn: boolean
  /** Whether the row is under a title query, where its Open/Closed place is not implied by a section. */
  searching: boolean
  onHover: () => void
  onOpen: () => void
  onToggleTurn: () => void
  onDelete: () => void
}

const swallowFocus = (event: MouseEvent): void => event.preventDefault()

/**
 * One command-palette row: a live-state glyph (or the provider's mark when idle), the title with
 * its matched characters, the folder as a dim description, and the time on the right. Pause/resume
 * and delete stay in the row so keyboard users reach them by selection, but only paint when the
 * row is selected or hovered.
 */
export function HeaderChatSearchRow({
  hit, id, selected, busy, changingTurn, searching, onHover, onOpen, onToggleTurn, onDelete
}: HeaderChatSearchRowProps): JSX.Element {
  const { row, status } = hit
  const when = chatSearchWhen(hit, formatChatTime)
  const place = chatSearchPlace(hit)
  const surfaceLabel = chatHistorySurfaceLabel(row.quickChatSurface)
  const label = [surfaceLabel, chatSearchMeta(hit, formatChatTime)].filter(Boolean).join(' · ')
  const turnControl = row.running ? 'pause' : row.paused ? 'resume' : null
  const turnButton = {
    className: 'header-chat-search-turn',
    'data-ui-key': row.paneId,
    'aria-label': `${row.running ? 'Pause' : 'Resume'} “${row.title}”`,
    title: row.running ? 'Pause chat' : 'Resume chat',
    disabled: busy,
    onMouseDown: swallowFocus,
    onClick: onToggleTurn,
    children: changingTurn
      ? <LoaderCircle size={14} className="header-chat-search-spinner" aria-hidden="true" />
      : row.running ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />
  }

  return <div id={id} role="row" aria-selected={selected} className="header-chat-search-row"
    data-status={status} onMouseEnter={onHover}>
    <div role="gridcell" className="header-chat-search-main">
      <button type="button" tabIndex={-1} className="header-chat-search-result"
        aria-label={`${row.title} — ${label}${status === 'completed' ? ' — Unread' : ''}`}
        data-ui="titlebar.chat-search-result" data-ui-key={row.paneId} disabled={busy} title={row.cwd}
        onMouseDown={swallowFocus} onClick={onOpen}>
        <span className="header-chat-search-symbol" aria-hidden="true">
          {status === 'running' ? <LoaderCircle size={15} className="header-chat-search-spinner" />
            : status === 'paused' ? <Pause size={14} />
            : status === 'completed' ? <span className="header-chat-search-dot" />
            : row.quickChatSurface === 'notepad'
              ? <ChatHistorySurfaceMark surface={row.quickChatSurface} size={15} className="header-chat-search-surface" />
              : <ProviderMark provider={row.provider} className="header-chat-search-provider" />}
        </span>
        <span className="header-chat-search-title">
          {segmentTitle(row.title, hit.titleRanges).map((segment, position) => segment.matched
            ? <mark key={position}>{segment.text}</mark> : <span key={position}>{segment.text}</span>)}
        </span>
        {hit.folder && <span className="header-chat-search-folder">{hit.folder}</span>}
        <span className="header-chat-search-meta">
          {searching && place && <span className="header-chat-search-place">{place}</span>}
          {when && <span className="header-chat-search-when">{when}</span>}
        </span>
      </button>
    </div>
    <div role="gridcell" className="header-chat-search-actions">
      {turnControl === 'pause' && <button type="button" {...turnButton} data-ui="titlebar.chat-search-pause" />}
      {turnControl === 'resume' && <button type="button" {...turnButton} data-ui="titlebar.chat-search-resume" />}
      <button type="button" className="header-chat-search-delete"
        data-ui="titlebar.chat-search-delete" data-ui-key={row.paneId}
        aria-label={`Delete “${row.title}”`}
        title={row.running ? 'Wait for this chat to finish before deleting' : 'Delete chat'}
        disabled={busy || row.running}
        onMouseDown={swallowFocus} onClick={onDelete}>
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  </div>
}
