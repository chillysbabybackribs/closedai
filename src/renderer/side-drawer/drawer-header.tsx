import type { JSX } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import type { ChatController } from '../chat-controller.js'
import { formatChatTime } from './drawer-format.js'
import { searchChats, segmentTitle, stepHighlight, type ChatSearchHit } from './drawer-search.js'
import type { DrawerRowModel } from './drawer-types.js'

export function DrawerHeader({
  chat,
  rows
}: {
  chat: ChatController
  rows: DrawerRowModel[]
}): JSX.Element {
  return (
    <header className="agents-header">
      <button
        type="button"
        className="agents-new"
        onClick={() => void chat.newThread()}
        title="New agent chat"
        aria-label="New Agent"
      >
        <Plus size={14} aria-hidden="true" />
        <span>New Agent</span>
      </button>
      <DrawerSearchInput chat={chat} rows={rows} />
    </header>
  )
}

function DrawerSearchInput({
  chat,
  rows
}: {
  chat: ChatController
  rows: DrawerRowModel[]
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const hits = useMemo(() => searchChats(rows, query), [rows, query])
  const isOpen = isFocused && query.trim() !== ''
  const cursor = hits.length === 0 ? 0 : Math.min(highlight, hits.length - 1)

  const open = useCallback(
    (hit: ChatSearchHit | undefined) => {
      if (!hit) return
      setQuery('')
      setHighlight(0)
      inputRef.current?.blur()
      if (hit.row.paneId && hit.row.paneId !== chat.selectedPaneId) {
        void chat.selectPane(hit.row.paneId)
      } else if (hit.row.threadId) {
        void chat.openThread(hit.row.threadId)
      }
    },
    [chat]
  )

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight(stepHighlight(cursor, event.key === 'ArrowDown' ? 1 : -1, hits.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      open(hits[cursor])
    } else if (event.key === 'Escape') {
      if (query === '') inputRef.current?.blur()
      else setQuery('')
    }
  }

  return (
    <div className="agents-search">
      <div className={`agents-search-field ${isOpen ? 'is-open' : ''}`}>
        <Search size={12} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search chats"
          spellCheck={false}
          aria-label="Search previous chats"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          role="combobox"
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlight(0)
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        {query !== '' ? (
          <button
            type="button"
            className="agents-search-clear"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            title="Clear search"
            aria-label="Clear search"
          >
            <X size={11} />
          </button>
        ) : null}
      </div>

      {isOpen ? (
        <div className="agents-search-results" role="listbox" aria-label="Chat search results">
          {hits.length === 0 ? (
            <p className="agents-search-empty">No matching chats</p>
          ) : (
            hits.map((hit, index) => (
              <button
                key={hit.row.id}
                type="button"
                role="option"
                aria-selected={index === cursor}
                className={`agents-search-result ${index === cursor ? 'is-active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault()
                  open(hit)
                }}
                onMouseEnter={() => setHighlight(index)}
              >
                <span className="agents-search-result-title">
                  {segmentTitle(hit.row.title, hit.titleRanges).map((segment, position) =>
                    segment.matched ? (
                      <mark key={position}>{segment.text}</mark>
                    ) : (
                      <span key={position}>{segment.text}</span>
                    )
                  )}
                </span>
                <span className="agents-search-result-meta">
                  {hit.folder ? `${hit.folder} · ` : ''}
                  {formatChatTime(hit.row.updatedAt)}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
