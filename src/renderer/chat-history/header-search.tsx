import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip.js'
import { Search, X } from '../icons/index.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { HistoryController } from './history-controller.js'
import { closesOnFocusOut, closesOnPointerDown } from './header-search-dismiss.js'
import { ChatSearchResults, useChatSearchList } from './chat-search-results.js'
import { useChatSearchActions } from './use-chat-search-actions.js'
import type { ChatReviewQueue } from './review-queue.js'

const SHEET_EXIT_MS = 160

type Phase = 'closed' | 'open' | 'closing'

/**
 * The palette has one state (`phase`) and closes only on discrete events: Escape, opening a
 * result, focus leaving the component, a press outside it, or the window losing focus (which is
 * what a click on the native browser view looks like from here). Nothing is inferred from pointer
 * position. Ranking and the keyboard cursor live in `useChatSearchList`, shared with Start.
 */
export const HeaderChatSearch = memo(function HeaderChatSearch({ chats, controller, activeChatId, openDeskChatIds = [], reviewQueue, busy = false, inputRef, onOpened, variant = 'titlebar', paneKey, title = 'Search chats' }: {
  chats: ChatRowSummary[]
  controller: HistoryController
  activeChatId: string | null
  /** Desk tabs in stable newest-opened order for the palette's top section. */
  openDeskChatIds?: readonly string[]
  reviewQueue?: ChatReviewQueue
  busy?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  onOpened?: () => void
  variant?: 'titlebar' | 'card'
  /** Per-card search inputs need distinct automation keys when several cards are visible. */
  paneKey?: string
  title?: string
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [phase, setPhase] = useState<Phase>('closed')
  // Synchronous mirror of `phase`: transitions triggered inside one event (open a result, then
  // blur the input) must see each other before React re-renders.
  const phaseRef = useRef<Phase>('closed')
  const rootRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const localInputRef = useRef<HTMLInputElement>(null)
  const resolvedInputRef = inputRef ?? localInputRef
  const [sheetDock, setSheetDock] = useState<CSSProperties>({})

  const transition = useCallback((next: Phase): void => {
    phaseRef.current = next
    setPhase(next)
  }, [])
  const sheetOpen = phase !== 'closed'
  const expanded = phase === 'open'
  const list = useChatSearchList(chats, query, sheetOpen, openDeskChatIds)
  const { setHighlightId } = list
  const show = useCallback((): void => {
    if (phaseRef.current === 'closed') setHighlightId(activeChatId)
    if (phaseRef.current !== 'open') transition('open')
  }, [transition, setHighlightId, activeChatId])
  const hide = useCallback((): void => {
    if (phaseRef.current === 'open') transition('closing')
  }, [transition])
  const finish = useCallback((): void => {
    if (phaseRef.current !== 'closed') transition('closed')
  }, [transition])

  // Workspace chat events keep these rows current. Opening a local dropdown must not
  // reconcile every provider's session catalog again.

  useEffect(() => {
    if (phase !== 'closing') return
    const timer = window.setTimeout(finish, SHEET_EXIT_MS + 40)
    return () => window.clearTimeout(timer)
  }, [finish, phase])

  const dockCardSheet = useCallback((): void => {
    if (variant !== 'card' || !fieldRef.current) return
    const rect = fieldRef.current.getBoundingClientRect()
    const card = rootRef.current?.closest('.chat-layout-tile')
    if (!card) return
    const bounds = card.getBoundingClientRect()
    const width = Math.max(0, Math.min(480, bounds.width - 48))
    const left = bounds.left + (bounds.width - width) / 2
    const composer = card.querySelector('.composer')?.getBoundingClientRect()
    const bottom = Math.min(bounds.bottom - 16, (composer?.top ?? bounds.bottom) - 8)
    const top = Math.max(rect.bottom + 6, card.querySelector('.chat-layout-header')?.getBoundingClientRect().bottom ?? rect.bottom + 6)
    setSheetDock({
      position: 'fixed',
      top,
      left,
      width,
      transform: 'none',
      maxHeight: Math.max(0, bottom - top)
    })
  }, [variant])

  useLayoutEffect(() => {
    if (variant !== 'card' || !sheetOpen) {
      setSheetDock({})
      return
    }
    dockCardSheet()
    const observer = new ResizeObserver(dockCardSheet)
    const card = rootRef.current?.closest('.chat-layout-tile')
    if (card) {
      observer.observe(card)
      const composer = card.querySelector('.composer')
      if (composer) observer.observe(composer)
    }
    // Scrolling the result list itself never moves the field; re-docking on it re-rendered every row per frame.
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && sheetRef.current?.contains(event.target)) return
      dockCardSheet()
    }
    window.addEventListener('resize', dockCardSheet)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', dockCardSheet)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [variant, sheetOpen, dockCardSheet, query, phase])

  useLayoutEffect(() => {
    if (variant === 'card' && expanded) resolvedInputRef.current?.focus()
  }, [variant, expanded, resolvedInputRef])

  useEffect(() => {
    if (!expanded) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target instanceof Node ? event.target : null
      if (rootRef.current && closesOnPointerDown(rootRef.current, target, sheetRef.current)) hide()
    }
    const onWindowBlur = (): void => hide()
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [expanded, hide])

  const { open, archive, archiving, busy: actionBusy } = useChatSearchActions(controller, {
    onOpened: () => {
      onOpened?.()
      setQuery('')
      setHighlightId(null)
      finish()
      resolvedInputRef.current?.blur()
    },
    // Keep keyboard focus in the search when a row's control disappears.
    keepFocus: () => resolvedInputRef.current?.focus()
  })

  const searchField = (
    <div ref={variant === 'card' ? undefined : fieldRef} className="header-chat-search-field">
      {variant !== 'card' && <Search size={15} aria-hidden="true" />}
      <input ref={resolvedInputRef} type="text" value={query} placeholder="Search chats"
        aria-label="Search chats" role="combobox" aria-autocomplete="list" aria-haspopup="grid"
        aria-expanded={expanded} aria-controls={sheetOpen ? list.listId : undefined}
        aria-activedescendant={expanded ? list.activeDescendant : undefined}
        autoComplete="off" spellCheck={false} data-ui="titlebar.chat-search" data-ui-key={paneKey}
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
      {query && <button type="button" className="header-chat-search-clear" aria-label="Clear chat search"
        data-ui="titlebar.chat-search-clear" onMouseDown={event => event.preventDefault()}
        onClick={() => { setQuery(''); setHighlightId(null); resolvedInputRef.current?.focus() }}>
        <X size={14} aria-hidden="true" />
      </button>}
    </div>
  )

  const sheet = sheetOpen && <div ref={sheetRef} className={`header-chat-search-sheet${variant === 'card' ? ' header-chat-search header-chat-search-sheet-dock' : ''}`}
      style={variant === 'card' ? sheetDock : undefined}
      data-phase={phase === 'closing' ? 'closing' : 'open'}
      onBlur={event => {
        if (rootRef.current && closesOnFocusOut(rootRef.current, event.relatedTarget, sheetRef.current)) hide()
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          hide()
          if (variant === 'card') triggerRef.current?.focus()
          else resolvedInputRef.current?.blur()
        }
      }}
      onMouseDown={event => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault() }}>
      <div className="header-chat-search-popup" onAnimationEnd={event => {
        if (event.currentTarget !== event.target || event.animationName !== 'header-chat-search-exit') return
        finish()
      }}>
        {variant === 'card' && searchField}
        <ChatSearchResults list={list} query={query} busy={busy || actionBusy} pendingId={archiving}
          activeChatId={activeChatId} reviewQueue={reviewQueue ?? controller.reviewQueue}
          onOpen={(hit) => { void open(hit) }} onArchive={(hit) => { void archive(hit) }} />
      </div>
    </div>

  return <div ref={rootRef} className={`header-chat-search${variant === 'card' ? ' header-chat-search-card' : ''}`}
    data-slot="thread-search" data-expanded={expanded}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onBlur={event => {
    if (closesOnFocusOut(event.currentTarget, event.relatedTarget, sheetRef.current)) hide()
  }} onKeyDown={event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      hide()
      resolvedInputRef.current?.blur()
    }
  }}>
    {variant === 'card' ? <div ref={fieldRef} className="header-chat-search-title-wrap">
      <TooltipProvider>
        <Tooltip open={expanded ? false : undefined}>
          <TooltipTrigger asChild>
            <button ref={triggerRef} type="button" className="header-chat-search-trigger"
              data-ui="titlebar.chat-history-toggle" data-ui-key={paneKey}
              aria-label={`Search chats and open chat history: ${title}`}
              aria-expanded={expanded} aria-haspopup="grid" aria-controls={sheetOpen ? list.listId : undefined}
              onClick={() => { if (expanded) hide(); else show() }}>
              <Search size={14} aria-hidden="true" /><span>{title}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent className="chat-title-tooltip" side="bottom">{title}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div> : searchField}
    {variant === 'card' && sheet ? createPortal(sheet, document.body) : sheet}
    {controller.error && <div className="header-chat-search-error" role="alert">{controller.error}</div>}
  </div>
})
