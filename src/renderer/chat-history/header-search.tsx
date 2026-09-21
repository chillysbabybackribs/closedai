import { useEffect, useId, useMemo, useRef, useState, type JSX, type RefObject } from 'react'
import { LoaderCircle, MessageSquare, Pause, Play, Search, Trash2, X } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { HistoryController } from './history-controller.js'
import { formatChatTime } from './history-format.js'
import { chatSearchView, segmentTitle, stepHighlight, type ChatSearchHit } from './history-search.js'

export function HeaderChatSearch({ chats, controller, inputRef, onOpened }: {
  chats: ChatRowSummary[]
  controller: HistoryController
  inputRef: RefObject<HTMLInputElement | null>
  onOpened?: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [opening, setOpening] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [changingTurn, setChangingTurn] = useState<string | null>(null)
  const actionRef = useRef(false)
  const hoveredRef = useRef(false)
  const resultsRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const view = useMemo(() => chatSearchView(chats, query, controller.reviewQueue),
    [chats, query, controller.reviewQueue])
  const hits = useMemo(() => view.sections.flatMap(section => section.hits), [view])
  const cursor = Math.min(highlight, Math.max(0, hits.length - 1))
  const optionId = (index: number): string => `${listId}-${index}`

  useEffect(() => {
    resultsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, expanded, query, hits])

  const refreshChats = controller.refreshChats
  useEffect(() => {
    if (expanded) refreshChats()
  }, [expanded, refreshChats])

  const open = async (hit: ChatSearchHit | undefined): Promise<void> => {
    if (!hit || actionRef.current) return
    actionRef.current = true
    setOpening(true)
    try {
      await controller.openRow(hit.row.paneId)
      onOpened?.()
      setQuery('')
      setHighlight(0)
      setExpanded(false)
      inputRef.current?.blur()
    } catch (error) {
      controller.reportError(error)
    } finally {
      actionRef.current = false
      setOpening(false)
    }
  }

  const remove = async (hit: ChatSearchHit): Promise<void> => {
    if (hit.row.running || actionRef.current) return
    actionRef.current = true
    setDeleting(hit.row.paneId)
    // Keep keyboard focus in the search when its delete button disappears.
    inputRef.current?.focus()
    try {
      await controller.deleteRow(hit.row.paneId)
    } catch (error) {
      controller.reportError(error)
    } finally {
      actionRef.current = false
      setDeleting(null)
    }
  }

  const toggleTurn = async (hit: ChatSearchHit): Promise<void> => {
    if (actionRef.current || (!hit.row.running && !hit.row.paused)) return
    actionRef.current = true
    setChangingTurn(hit.row.paneId)
    inputRef.current?.focus()
    try {
      if (hit.row.running) await controller.pauseRow(hit.row.paneId)
      else await controller.resumeRow(hit.row.paneId)
    } catch (error) {
      controller.reportError(error)
    } finally {
      actionRef.current = false
      setChangingTurn(null)
    }
  }

  const busy = opening || deleting !== null || changingTurn !== null

  return <div className="header-chat-search" onPointerEnter={event => {
    if (event.pointerType === 'touch') return
    hoveredRef.current = true
    setExpanded(true)
  }} onPointerLeave={event => {
    if (event.pointerType === 'touch') return
    hoveredRef.current = false
    setExpanded(false)
  }} onBlur={event => {
    if (!hoveredRef.current && !event.currentTarget.contains(event.relatedTarget)) setExpanded(false)
  }} onKeyDown={event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setExpanded(false)
      inputRef.current?.blur()
    }
  }}>
    <div className="header-chat-search-field">
      <Search size={13} aria-hidden="true" />
      <input ref={inputRef} type="text" value={query} placeholder="Search chats"
        aria-label="Search previous chat titles" role="combobox" aria-autocomplete="list" aria-haspopup="grid"
        aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && hits.length ? optionId(cursor) : undefined}
        autoComplete="off" spellCheck={false} data-ui="titlebar.chat-search"
        onChange={event => { setQuery(event.target.value); setHighlight(0); setExpanded(true) }}
        onFocus={() => setExpanded(true)}
        onClick={() => setExpanded(true)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setExpanded(true)
            setHighlight(stepHighlight(cursor, event.key === 'ArrowDown' ? 1 : -1, hits.length))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            if (expanded) void open(hits[cursor])
          }
        }} />
      {(view.runningCount > 0 || view.unreadCount > 0) && <div className="header-chat-search-counts"
        role="status" aria-label={`${view.runningCount} running chats, ${view.unreadCount} unread completions`}>
        {view.runningCount > 0 && <span className="header-chat-search-count" data-status="running"
          title={`${view.runningCount} running chats`} aria-hidden="true">
          <LoaderCircle size={12} className="header-chat-search-spinner" />{view.runningCount}
        </span>}
        {view.unreadCount > 0 && <span className="header-chat-search-count" data-status="completed"
          title={`${view.unreadCount} unread completions`} aria-hidden="true">
          <span className="header-chat-search-dot" />{view.unreadCount}
        </span>}
      </div>}
      {query && <button type="button" className="header-chat-search-clear" aria-label="Clear chat search"
        data-ui="titlebar.chat-search-clear" onMouseDown={event => event.preventDefault()}
        onClick={() => { setQuery(''); setHighlight(0); inputRef.current?.focus() }}>
        <X size={12} aria-hidden="true" />
      </button>}
    </div>
    {expanded && <div className="header-chat-search-popup">
      <div ref={resultsRef} id={listId} role="grid" aria-label="Chat history suggestions" aria-busy={busy}>
        {view.sections.map(section => <div role="rowgroup" key={section.label}
          className="header-chat-search-section" aria-label={section.label}>
          <div role="row">
            <div role="columnheader" aria-colspan={2} className="header-chat-search-caption">
              {section.label}<span>{section.hits.length}</span>
            </div>
          </div>
          {section.hits.map(hit => {
            const index = hits.indexOf(hit)
            const status = hit.status === 'running' ? 'Running' : hit.status === 'paused' ? 'Paused' : hit.status === 'completed'
              ? `Finished ${formatChatTime(hit.completedAt!).toLowerCase()}` : formatChatTime(hit.row.updatedAt)
            return <div key={hit.row.paneId} id={optionId(index)} role="row"
              aria-selected={index === cursor} className="header-chat-search-row"
              onMouseEnter={() => setHighlight(index)}>
              <div role="gridcell" className="header-chat-search-main">
                <button type="button" tabIndex={-1}
                  aria-label={`${hit.row.title} — ${hit.row.cwd} — ${status}${hit.status === 'completed' ? ' — Unread' : ''}`}
                  className="header-chat-search-result" data-ui="titlebar.chat-search-result"
                  data-ui-key={hit.row.paneId} disabled={busy} title={hit.row.cwd}
                  onMouseDown={event => event.preventDefault()} onClick={() => { void open(hit) }}>
                  <span className="header-chat-search-symbol" data-status={hit.status} aria-hidden="true">
                    {hit.status === 'running' ? <LoaderCircle size={14} className="header-chat-search-spinner" />
                      : hit.status === 'paused' ? <Pause size={14} />
                      : hit.status === 'completed' ? <span className="header-chat-search-dot" /> : <MessageSquare size={14} />}
                  </span>
                  <span className="header-chat-search-copy">
                    <span className="header-chat-search-title">
                      {segmentTitle(hit.row.title, hit.titleRanges).map((segment, position) => segment.matched
                        ? <mark key={position}>{segment.text}</mark> : <span key={position}>{segment.text}</span>)}
                    </span>
                    <span className="header-chat-search-meta">
                      {hit.folder ? `${hit.folder} · ` : ''}{status}
                    </span>
                  </span>
                </button>
              </div>
              <div role="gridcell" className="header-chat-search-actions">
                {(hit.row.running || hit.row.paused) && <button type="button"
                  className="header-chat-search-turn"
                  data-ui={hit.row.running ? 'titlebar.chat-search-pause' : 'titlebar.chat-search-resume'}
                  data-ui-key={hit.row.paneId}
                  aria-label={`${hit.row.running ? 'Pause' : 'Resume'} “${hit.row.title}”`}
                  title={hit.row.running ? 'Pause chat' : 'Resume chat'} disabled={busy}
                  onMouseDown={event => event.preventDefault()} onClick={() => { void toggleTurn(hit) }}>
                  {changingTurn === hit.row.paneId ? <LoaderCircle size={14} className="header-chat-search-spinner" aria-hidden="true" />
                    : hit.row.running ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                </button>}
                <button type="button" className="header-chat-search-delete"
                  data-ui="titlebar.chat-search-delete" data-ui-key={hit.row.paneId}
                  aria-label={`Delete “${hit.row.title}”`}
                  title={hit.row.running ? 'Wait for this chat to finish before deleting' : 'Delete chat'}
                  disabled={busy || hit.row.running}
                  onMouseDown={event => event.preventDefault()} onClick={() => { void remove(hit) }}>
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          })}
        </div>)}
      </div>
      {!hits.length && <p className="header-chat-search-empty" role="status">
        {query.trim() ? 'No matching chats' : 'No previous chats'}
      </p>}
      <div className="header-chat-search-footer" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
        <span><kbd>↵</kbd> Open</span>
        <span><kbd>esc</kbd> Close</span>
      </div>
    </div>}
    {controller.error && <div className="header-chat-search-error" role="alert">{controller.error}</div>}
  </div>
}
