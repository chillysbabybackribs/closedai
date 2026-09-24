import { useCallback, useEffect, useId, useMemo, useRef, useState, type JSX, type RefObject } from 'react'
import { MessageSquareDashed, Search, SearchX, X } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { HistoryController } from './history-controller.js'
import { closesOnFocusOut, closesOnPointerDown, cursorIndex } from './header-search-dismiss.js'
import { HeaderChatSearchRow } from './header-search-row.js'
import { chatSearchFooter, chatSearchView, stepHighlight, type ChatSearchHit } from './history-search.js'

const SHEET_EXIT_MS = 160
/** Ranked title/preview matches shown for a query; the footer reports the full count. */
const QUERY_RESULT_LIMIT = 40
const NO_CHATS: ChatRowSummary[] = []

type Phase = 'closed' | 'open' | 'closing'

/**
 * The palette has one state (`phase`) and closes only on discrete events: Escape, opening a
 * result, focus leaving the component, a press outside it, or the window losing focus (which is
 * what a click on the native browser view looks like from here). Nothing is inferred from pointer
 * position. The keyboard cursor is the highlighted chat's id, so a list that reorders under it
 * (a turn finishing, a refresh adopting threads) never changes which chat Enter opens.
 */
export function HeaderChatSearch({ chats, controller, inputRef, onOpened }: {
  chats: ChatRowSummary[]
  controller: HistoryController
  inputRef: RefObject<HTMLInputElement | null>
  onOpened?: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [phase, setPhase] = useState<Phase>('closed')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [changingTurn, setChangingTurn] = useState<string | null>(null)
  // Synchronous mirror of `phase`: transitions triggered inside one event (open a result, then
  // blur the input) must see each other before React re-renders.
  const phaseRef = useRef<Phase>('closed')
  const actionRef = useRef(false)
  const keyboardMoveRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const transition = useCallback((next: Phase): void => {
    phaseRef.current = next
    setPhase(next)
  }, [])
  const show = useCallback((): void => {
    if (phaseRef.current === 'closed') setHighlightId(null)
    if (phaseRef.current !== 'open') transition('open')
  }, [transition])
  const hide = useCallback((): void => {
    if (phaseRef.current === 'open') transition('closing')
  }, [transition])
  const finish = useCallback((): void => {
    if (phaseRef.current !== 'closed') transition('closed')
  }, [transition])

  const sheetOpen = phase !== 'closed'
  const expanded = phase === 'open'
  // Workspace rows update on every chat event; while the sheet is closed nothing reads the view,
  // so a closed palette costs no ranking over a large history.
  const view = useMemo(() => chatSearchView(sheetOpen ? chats : NO_CHATS, query, controller.reviewQueue,
    { query: QUERY_RESULT_LIMIT }), [sheetOpen, chats, query, controller.reviewQueue])
  const hits = useMemo(() => view.sections.flatMap(section => section.hits), [view])
  const ids = useMemo(() => hits.map(hit => hit.row.paneId), [hits])
  const indexOf = useMemo(() => new Map(ids.map((id, index) => [id, index])), [ids])
  const cursor = cursorIndex(ids, highlightId)
  const optionId = (index: number): string => `${listId}-${index}`

  // Keyboard moves keep the cursor in view; hovering never scrolls, or a row scrolling under the
  // pointer would re-highlight and scroll again.
  useEffect(() => {
    if (!expanded || !keyboardMoveRef.current) return
    keyboardMoveRef.current = false
    resultsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, expanded])

  const refreshChats = controller.refreshChats
  useEffect(() => {
    if (!expanded) return
    const idle = window.requestIdleCallback?.(() => refreshChats(), { timeout: 600 })
    const timer = idle === undefined ? window.setTimeout(refreshChats, 0) : null
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [expanded, refreshChats])

  useEffect(() => {
    if (phase !== 'closing') return
    const timer = window.setTimeout(finish, SHEET_EXIT_MS + 40)
    return () => window.clearTimeout(timer)
  }, [finish, phase])

  useEffect(() => {
    if (!expanded) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target instanceof Node ? event.target : null
      if (rootRef.current && closesOnPointerDown(rootRef.current, target)) hide()
    }
    const onWindowBlur = (): void => hide()
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [expanded, hide])

  const open = async (hit: ChatSearchHit | undefined): Promise<void> => {
    if (!hit || actionRef.current) return
    actionRef.current = true
    setOpening(true)
    try {
      await controller.openRow(hit.row.paneId)
      onOpened?.()
      setQuery('')
      setHighlightId(null)
      finish()
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

  return <div ref={rootRef} className="header-chat-search" data-expanded={expanded} onBlur={event => {
    if (closesOnFocusOut(event.currentTarget, event.relatedTarget)) hide()
  }} onKeyDown={event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      hide()
      inputRef.current?.blur()
    }
  }}>
    <div className="header-chat-search-field">
      <Search size={15} aria-hidden="true" />
      <input ref={inputRef} type="text" value={query} placeholder="Search chats"
        aria-label="Search previous chat titles" role="combobox" aria-autocomplete="list" aria-haspopup="grid"
        aria-expanded={expanded} aria-controls={sheetOpen ? listId : undefined}
        aria-activedescendant={expanded && hits.length ? optionId(cursor) : undefined}
        autoComplete="off" spellCheck={false} data-ui="titlebar.chat-search"
        onChange={event => { setQuery(event.target.value); setHighlightId(null); show() }}
        onFocus={show}
        onClick={show}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show()
            keyboardMoveRef.current = true
            setHighlightId(ids[stepHighlight(cursor, event.key === 'ArrowDown' ? 1 : -1, ids.length)] ?? null)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            if (expanded) void open(hits[cursor])
          }
        }} />
      {query
        ? <button type="button" className="header-chat-search-clear" aria-label="Clear chat search"
          data-ui="titlebar.chat-search-clear" onMouseDown={event => event.preventDefault()}
          onClick={() => { setQuery(''); setHighlightId(null); inputRef.current?.focus() }}>
          <X size={14} aria-hidden="true" />
        </button>
        : <span className="header-chat-search-hint" aria-hidden="true"><kbd>Ctrl</kbd><kbd>H</kbd></span>}
    </div>
    {sheetOpen && <div className="header-chat-search-sheet" data-phase={phase === 'closing' ? 'closing' : 'open'}
      onMouseDown={event => event.preventDefault()}>
      <div className="header-chat-search-popup" onAnimationEnd={event => {
        if (event.currentTarget !== event.target || event.animationName !== 'header-chat-search-exit') return
        finish()
      }}>
        <div ref={resultsRef} id={listId} role="grid" aria-label="Chat history suggestions" aria-busy={busy}
          className="header-chat-search-list">
          {view.sections.map(section => <div role="rowgroup" key={section.label}
            className="header-chat-search-section" aria-label={section.label}>
            <div role="row">
              <div role="columnheader" aria-colspan={2} className="header-chat-search-caption">
                {section.label}<span>{section.total > section.hits.length
                  ? `${section.hits.length} of ${section.total}` : section.hits.length}</span>
              </div>
            </div>
            {section.hits.map(hit => {
              const index = indexOf.get(hit.row.paneId) ?? -1
              return <HeaderChatSearchRow key={hit.row.paneId} hit={hit} id={optionId(index)}
                selected={index === cursor} busy={busy} changingTurn={changingTurn === hit.row.paneId}
                searching={searching} onHover={() => setHighlightId(hit.row.paneId)}
                onOpen={() => { void open(hit) }} onToggleTurn={() => { void toggleTurn(hit) }}
                onDelete={() => { void remove(hit) }} />
            })}
          </div>)}
          {!hits.length && <div className="header-chat-search-empty" role="status">
            {searching ? <SearchX size={20} aria-hidden="true" /> : <MessageSquareDashed size={20} aria-hidden="true" />}
            <strong>{searching ? 'No matching chats' : 'No previous chats'}</strong>
            <span>{searching ? `Nothing titled or saying “${query.trim()}”` : 'Chats appear here once they have a title'}</span>
          </div>}
        </div>
        <div className="header-chat-search-footer">
          <span aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd>Navigate</span>
          <span aria-hidden="true"><kbd>↵</kbd>Open</span>
          <span aria-hidden="true"><kbd>Esc</kbd>Close</span>
          <span className="header-chat-search-count">{chatSearchFooter(hits.length, view.total, searching)}</span>
        </div>
      </div>
    </div>}
    {controller.error && <div className="header-chat-search-error" role="alert">{controller.error}</div>}
  </div>
}
