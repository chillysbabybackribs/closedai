import { useEffect, useId, useMemo, useRef, useState, type JSX, type RefObject } from 'react'
import { MessageSquareDashed, Search, SearchX, X } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { HistoryController } from './history-controller.js'
import { HeaderChatSearchRow } from './header-search-row.js'
import { chatSearchView, stepHighlight, type ChatSearchHit } from './history-search.js'

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
  const searching = query.trim() !== ''

  return <div className="header-chat-search" data-expanded={expanded} onPointerEnter={event => {
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
      <Search size={15} aria-hidden="true" />
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
      {query
        ? <button type="button" className="header-chat-search-clear" aria-label="Clear chat search"
          data-ui="titlebar.chat-search-clear" onMouseDown={event => event.preventDefault()}
          onClick={() => { setQuery(''); setHighlight(0); inputRef.current?.focus() }}>
          <X size={14} aria-hidden="true" />
        </button>
        : <span className="header-chat-search-hint" aria-hidden="true"><kbd>Ctrl</kbd><kbd>H</kbd></span>}
    </div>
    {expanded && <div className="header-chat-search-popup">
      <div ref={resultsRef} id={listId} role="grid" aria-label="Chat history suggestions" aria-busy={busy}
        className="header-chat-search-list">
        {view.sections.map(section => <div role="rowgroup" key={section.label}
          className="header-chat-search-section" aria-label={section.label}>
          <div role="row">
            <div role="columnheader" aria-colspan={2} className="header-chat-search-caption">
              {section.label}<span>{section.hits.length}</span>
            </div>
          </div>
          {section.hits.map(hit => {
            const index = hits.indexOf(hit)
            return <HeaderChatSearchRow key={hit.row.paneId} hit={hit} id={optionId(index)}
              selected={index === cursor} busy={busy} changingTurn={changingTurn === hit.row.paneId}
              searching={searching} onHover={() => setHighlight(index)}
              onOpen={() => { void open(hit) }} onToggleTurn={() => { void toggleTurn(hit) }}
              onDelete={() => { void remove(hit) }} />
          })}
        </div>)}
        {!hits.length && <div className="header-chat-search-empty" role="status">
          {searching ? <SearchX size={20} aria-hidden="true" /> : <MessageSquareDashed size={20} aria-hidden="true" />}
          <strong>{searching ? 'No matching chats' : 'No previous chats'}</strong>
          <span>{searching ? `Nothing titled like “${query.trim()}”` : 'Chats appear here once they have a title'}</span>
        </div>}
      </div>
      <div className="header-chat-search-footer">
        <span aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd>Navigate</span>
        <span aria-hidden="true"><kbd>↵</kbd>Open</span>
        <span aria-hidden="true"><kbd>Esc</kbd>Close</span>
        <span className="header-chat-search-count">
          {searching ? `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`
            : `${hits.length} ${hits.length === 1 ? 'chat' : 'chats'}`}
        </span>
      </div>
    </div>}
    {controller.error && <div className="header-chat-search-error" role="alert">{controller.error}</div>}
  </div>
}
