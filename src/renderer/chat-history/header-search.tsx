import { useCallback, useEffect, useRef, useState, type JSX, type RefObject } from 'react'
import { Search, X } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { HistoryController } from './history-controller.js'
import { closesOnFocusOut, closesOnPointerDown } from './header-search-dismiss.js'
import { ChatSearchFooter, ChatSearchResults, useChatSearchList } from './chat-search-results.js'
import { useChatSearchActions } from './use-chat-search-actions.js'

const SHEET_EXIT_MS = 160

type Phase = 'closed' | 'open' | 'closing'

/**
 * The palette has one state (`phase`) and closes only on discrete events: Escape, opening a
 * result, focus leaving the component, a press outside it, or the window losing focus (which is
 * what a click on the native browser view looks like from here). Nothing is inferred from pointer
 * position. Ranking and the keyboard cursor live in `useChatSearchList`, shared with Start.
 */
export function HeaderChatSearch({ chats, controller, inputRef, onOpened }: {
  chats: ChatRowSummary[]
  controller: HistoryController
  inputRef: RefObject<HTMLInputElement | null>
  onOpened?: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [phase, setPhase] = useState<Phase>('closed')
  // Synchronous mirror of `phase`: transitions triggered inside one event (open a result, then
  // blur the input) must see each other before React re-renders.
  const phaseRef = useRef<Phase>('closed')
  const rootRef = useRef<HTMLDivElement>(null)

  const transition = useCallback((next: Phase): void => {
    phaseRef.current = next
    setPhase(next)
  }, [])
  const sheetOpen = phase !== 'closed'
  const expanded = phase === 'open'
  const list = useChatSearchList(chats, query, controller.reviewQueue, sheetOpen)
  const { setHighlightId } = list
  const show = useCallback((): void => {
    if (phaseRef.current === 'closed') setHighlightId(null)
    if (phaseRef.current !== 'open') transition('open')
  }, [transition, setHighlightId])
  const hide = useCallback((): void => {
    if (phaseRef.current === 'open') transition('closing')
  }, [transition])
  const finish = useCallback((): void => {
    if (phaseRef.current !== 'closed') transition('closed')
  }, [transition])

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

  const { open, remove, toggleTurn, changingTurn, busy } = useChatSearchActions(controller, {
    onOpened: () => {
      onOpened?.()
      setQuery('')
      setHighlightId(null)
      finish()
      inputRef.current?.blur()
    },
    // Keep keyboard focus in the search when a row's control disappears.
    keepFocus: () => inputRef.current?.focus()
  })
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
        aria-expanded={expanded} aria-controls={sheetOpen ? list.listId : undefined}
        aria-activedescendant={expanded ? list.activeDescendant : undefined}
        autoComplete="off" spellCheck={false} data-ui="titlebar.chat-search"
        onChange={event => { setQuery(event.target.value); setHighlightId(null); show() }}
        onFocus={show}
        onClick={show}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show()
            list.step(event.key === 'ArrowDown' ? 1 : -1)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            if (expanded) void open(list.current)
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
        <ChatSearchResults list={list} query={query} busy={busy} changingTurn={changingTurn}
          onOpen={(hit) => { void open(hit) }} onToggleTurn={(hit) => { void toggleTurn(hit) }}
          onDelete={(hit) => { void remove(hit) }} />
        <ChatSearchFooter list={list} searching={searching} escape="Close" />
      </div>
    </div>}
    {controller.error && <div className="header-chat-search-error" role="alert">{controller.error}</div>}
  </div>
}
