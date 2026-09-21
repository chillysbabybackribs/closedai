import { useEffect, useId, useMemo, useRef, useState, type JSX, type RefObject } from 'react'
import { Search, X } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { HistoryController } from './history-controller.js'
import { formatChatTime } from './history-format.js'
import { searchChats, segmentTitle, stepHighlight, type ChatSearchHit } from './history-search.js'

export function HeaderChatSearch({ chats, controller, inputRef, onOpened }: {
  chats: ChatRowSummary[]
  controller: HistoryController
  inputRef: RefObject<HTMLInputElement | null>
  onOpened?: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [focused, setFocused] = useState(false)
  const [opening, setOpening] = useState(false)
  const resultsRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const hits = useMemo(() => searchChats(chats, query), [chats, query])
  const cursor = Math.min(highlight, Math.max(0, hits.length - 1))
  const optionId = (index: number): string => `${listId}-${index}`

  useEffect(() => {
    resultsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, focused, query])

  const open = async (hit: ChatSearchHit | undefined): Promise<void> => {
    if (!hit || opening) return
    setOpening(true)
    try {
      await controller.openRow(hit.row.paneId)
      onOpened?.()
      setQuery('')
      setHighlight(0)
      setFocused(false)
      inputRef.current?.blur()
    } catch (error) {
      controller.reportError(error)
    } finally {
      setOpening(false)
    }
  }

  return <div className="header-chat-search">
    <div className="header-chat-search-field">
      <Search size={13} aria-hidden="true" />
      <input ref={inputRef} type="text" value={query} placeholder="Search chats"
        aria-label="Search previous chat titles" role="combobox" aria-autocomplete="list"
        aria-expanded={focused} aria-controls={focused ? listId : undefined}
        aria-activedescendant={focused && hits.length ? optionId(cursor) : undefined}
        autoComplete="off" spellCheck={false} data-ui="titlebar.chat-search"
        onChange={event => { setQuery(event.target.value); setHighlight(0); setFocused(true) }}
        onFocus={() => { setFocused(true); controller.refreshChats() }}
        onBlur={() => setFocused(false)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setFocused(true)
            setHighlight(stepHighlight(cursor, event.key === 'ArrowDown' ? 1 : -1, hits.length))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            if (focused) void open(hits[cursor])
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setFocused(false)
            inputRef.current?.blur()
          }
        }} />
      {query && <button type="button" className="header-chat-search-clear" aria-label="Clear chat search"
        data-ui="titlebar.chat-search-clear" onMouseDown={event => event.preventDefault()}
        onClick={() => { setQuery(''); setHighlight(0); inputRef.current?.focus() }}>
        <X size={12} aria-hidden="true" />
      </button>}
    </div>
    {focused && <div className="header-chat-search-popup">
      <div className="header-chat-search-caption">{query.trim() ? 'Matching chats' : 'Recent chats'}</div>
      <div ref={resultsRef} id={listId} role="listbox" aria-label="Chat history suggestions" aria-busy={opening}>
        {hits.map((hit, index) => <button key={hit.row.paneId} id={optionId(index)}
          type="button" role="option" tabIndex={-1} aria-selected={index === cursor}
          aria-label={`${hit.row.title} — ${hit.row.cwd}${hit.row.running ? ' — Running' : ''}`}
          className="header-chat-search-result" data-ui="titlebar.chat-search-result"
          data-ui-key={hit.row.paneId} disabled={opening} title={hit.row.cwd}
          onMouseDown={event => event.preventDefault()} onClick={() => { void open(hit) }}
          onMouseEnter={() => setHighlight(index)}>
          <span className="header-chat-search-title">
            {segmentTitle(hit.row.title, hit.titleRanges).map((segment, position) => segment.matched
              ? <mark key={position}>{segment.text}</mark> : <span key={position}>{segment.text}</span>)}
          </span>
          <span className="header-chat-search-meta">
            {hit.folder ? `${hit.folder} · ` : ''}{hit.row.running ? 'Running' : formatChatTime(hit.row.updatedAt)}
          </span>
        </button>)}
      </div>
      {!hits.length && <p className="header-chat-search-empty" role="status">
        {query.trim() ? 'No matching chats' : 'No previous chats'}
      </p>}
    </div>}
    {controller.error && <div className="header-chat-search-error" role="alert">{controller.error}</div>}
  </div>
}
