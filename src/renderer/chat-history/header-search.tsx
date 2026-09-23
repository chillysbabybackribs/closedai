import { useCallback, useEffect, useId, useMemo, useRef, useState, type JSX, type RefObject } from 'react'
import { MessageSquareDashed, Search, SearchX, X } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { HistoryController } from './history-controller.js'
import { pointerKeepsSearchOpen } from './header-search-hover.js'
import { HeaderChatSearchRow } from './header-search-row.js'
import { chatSearchView, stepHighlight, type ChatSearchHit } from './history-search.js'

/** Pause before the exit fade so a stray edge crossing does not flicker the palette shut. */
const POINTER_DISMISS_GRACE_MS = 120
const SHEET_EXIT_MS = 160

export function HeaderChatSearch({ chats, controller, inputRef, onOpened }: {
  chats: ChatRowSummary[]
  controller: HistoryController
  inputRef: RefObject<HTMLInputElement | null>
  onOpened?: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [closing, setClosing] = useState(false)
  const [opening, setOpening] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [changingTurn, setChangingTurn] = useState<string | null>(null)
  const actionRef = useRef(false)
  const hoveredRef = useRef(false)
  const fieldRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const dismissGraceRef = useRef<number | null>(null)
  const listId = useId()
  const sheetOpen = expanded || closing
  const sheetPhase = closing ? 'closing' : 'open'

  const clearDismissGrace = useCallback((): void => {
    if (dismissGraceRef.current === null) return
    window.clearTimeout(dismissGraceRef.current)
    dismissGraceRef.current = null
  }, [])

  const finishSheetClose = useCallback((): void => {
    clearDismissGrace()
    setClosing(false)
    setExpanded(false)
  }, [clearDismissGrace])

  const beginSheetClose = useCallback((): void => {
    if (!expanded || closing) return
    clearDismissGrace()
    setClosing(true)
  }, [clearDismissGrace, closing, expanded])

  const dismissSheet = useCallback((graceMs = POINTER_DISMISS_GRACE_MS): void => {
    clearDismissGrace()
    if (!expanded || closing) return
    if (graceMs <= 0) {
      beginSheetClose()
      return
    }
    dismissGraceRef.current = window.setTimeout(() => {
      dismissGraceRef.current = null
      beginSheetClose()
    }, graceMs)
  }, [beginSheetClose, clearDismissGrace, closing, expanded])

  const cancelSheetDismiss = useCallback((): void => {
    clearDismissGrace()
    setClosing(false)
  }, [clearDismissGrace])
  const view = useMemo(() => chatSearchView(chats, query, controller.reviewQueue),
    [chats, query, controller.reviewQueue])
  const hits = useMemo(() => view.sections.flatMap(section => section.hits), [view])
  const cursor = Math.min(highlight, Math.max(0, hits.length - 1))
  const optionId = (index: number): string => `${listId}-${index}`

  useEffect(() => {
    if (!sheetOpen || closing) return
    resultsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [closing, cursor, sheetOpen])

  const refreshChats = controller.refreshChats
  useEffect(() => {
    if (!sheetOpen || closing) return
    const idle = window.requestIdleCallback?.(() => refreshChats(), { timeout: 600 })
    const timer = idle === undefined ? window.setTimeout(refreshChats, 0) : null
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [closing, refreshChats, sheetOpen])

  useEffect(() => () => clearDismissGrace(), [clearDismissGrace])

  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(finishSheetClose, SHEET_EXIT_MS + 40)
    return () => window.clearTimeout(timer)
  }, [closing, finishSheetClose])

  // While open, pointer geometry (not DOM enter/leave) decides when to dismiss: the popup is wider
  // than the field, and in Electron a native browser view can cover part of it until the freeze
  // still lands, so the renderer may see a leave while the pointer is still inside the popup's box.
  // Only an inside-to-outside transition closes; a popup opened by keyboard with the pointer
  // elsewhere stays open until the pointer has actually visited the field or popup.
  useEffect(() => {
    if (!sheetOpen) return
    const track = (event: PointerEvent): void => {
      if (event.pointerType === 'touch' || !fieldRef.current) return
      const inside = pointerKeepsSearchOpen({ x: event.clientX, y: event.clientY },
        fieldRef.current.getBoundingClientRect(), popupRef.current?.getBoundingClientRect() ?? null)
      if (inside) {
        hoveredRef.current = true
        cancelSheetDismiss()
      } else if (hoveredRef.current) {
        hoveredRef.current = false
        dismissSheet()
      }
    }
    window.addEventListener('pointermove', track, { passive: true })
    document.documentElement.addEventListener('pointerleave', track)
    return () => {
      window.removeEventListener('pointermove', track)
      document.documentElement.removeEventListener('pointerleave', track)
    }
  }, [cancelSheetDismiss, dismissSheet, sheetOpen])

  const open = async (hit: ChatSearchHit | undefined): Promise<void> => {
    if (!hit || actionRef.current) return
    actionRef.current = true
    setOpening(true)
    try {
      await controller.openRow(hit.row.paneId)
      onOpened?.()
      setQuery('')
      setHighlight(0)
      finishSheetClose()
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

  return <div className="header-chat-search" data-expanded={sheetOpen && !closing} onBlur={event => {
    if (!hoveredRef.current && !event.currentTarget.contains(event.relatedTarget)) dismissSheet(0)
  }} onKeyDown={event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      dismissSheet(0)
      inputRef.current?.blur()
    }
  }}>
    <div ref={fieldRef} className="header-chat-search-field" onPointerDown={event => {
      if (event.pointerType === 'touch') return
      hoveredRef.current = true
    }}>
      <Search size={15} aria-hidden="true" />
      <input ref={inputRef} type="text" value={query} placeholder="Search chats"
        aria-label="Search previous chat titles" role="combobox" aria-autocomplete="list" aria-haspopup="grid"
        aria-expanded={sheetOpen && !closing} aria-controls={sheetOpen ? listId : undefined}
        aria-activedescendant={sheetOpen && !closing && hits.length ? optionId(cursor) : undefined}
        autoComplete="off" spellCheck={false} data-ui="titlebar.chat-search"
        onChange={event => { setQuery(event.target.value); setHighlight(0); cancelSheetDismiss(); setExpanded(true) }}
        onFocus={() => { cancelSheetDismiss(); setExpanded(true) }}
        onClick={() => { cancelSheetDismiss(); setExpanded(true) }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            cancelSheetDismiss()
            setExpanded(true)
            setHighlight(stepHighlight(cursor, event.key === 'ArrowDown' ? 1 : -1, hits.length))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            if (sheetOpen && !closing) void open(hits[cursor])
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
    {sheetOpen && <div ref={popupRef} className="header-chat-search-sheet" data-phase={sheetPhase}>
      <div className="header-chat-search-popup" onAnimationEnd={event => {
        if (event.currentTarget !== event.target || event.animationName !== 'header-chat-search-exit') return
        finishSheetClose()
      }}>
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
      </div>
    </div>}
    {controller.error && <div className="header-chat-search-error" role="alert">{controller.error}</div>}
  </div>
}
