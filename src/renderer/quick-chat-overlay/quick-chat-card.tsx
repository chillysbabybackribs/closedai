import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type JSX, type KeyboardEvent, type PointerEvent } from 'react'
import { AlertCircle, Check, ChevronDown, ChevronUp, Loader2, SquarePen } from 'lucide-react'
import { chatRunning, initialChatState, type ChatWorkspaceAction } from '../chat-state.js'
import { WorkspaceChat } from '../chat-layout/workspace-chat.js'
import { useWorkspacePaneSlice } from '../chat-layout/workspace-pane-subscription.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'
import { quickChatFeed, type QuickChatFeed } from './quick-chat-feed.js'
import { layerMenuOpen } from './layer-menu.js'

const request = (value: 'new' | 'close'): void => { void window.closedai.quickChat.request(value) }

/**
 * The open quick chat. While the user types it is the whole chat over the page; once a task runs
 * it retracts to the compact composer with a running feed, so the page the model is driving stays
 * in view. Typing into the composer, or a click on the card, brings the whole chat back.
 */
export const QuickChatCard = memo(function QuickChatCard({ paneId, focused, dispatch, appearance }: {
  paneId: string
  /** Whether the layer holds keyboard focus (main's view; the document is not told when the page takes it). */
  focused: boolean
  dispatch: Dispatch<ChatWorkspaceAction>
  appearance: AppearanceSettings
}): JSX.Element {
  const slice = useWorkspacePaneSlice(paneId)
  const state = slice.state ?? initialChatState()
  const running = chatRunning(state)
  const hasTranscript = state.items.length > 0
  const title = slice.chats.find((row) => row.paneId === paneId)?.title ?? 'New chat'
  const feed = useMemo(() => quickChatFeed(state), [state])
  const [expanded, setExpanded] = useState(true)
  const cardRef = useRef<HTMLDivElement>(null)

  // Opening lands in the composer, the way a click on the button reads.
  useEffect(() => {
    cardRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [])

  // A sent task retracts the chat to the compact composer and its running feed.
  const turnId = state.activeTurnId
  const previousTurn = useRef(turnId)
  useEffect(() => {
    if (turnId && turnId !== previousTurn.current) {
      setExpanded(false)
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    }
    previousTurn.current = turnId
  }, [turnId])

  // Leaving the layer (a click on the page) retracts it; an unused chat goes back to the button.
  const unused = !hasTranscript && !running
  const wasFocused = useRef(focused)
  useEffect(() => {
    const left = wasFocused.current && !focused
    wasFocused.current = focused
    if (!left || layerMenuOpen()) return
    if (unused) request('close')
    else setExpanded(false)
  }, [focused, unused])

  // Escape shrinks the whole chat, then closes. The layer is its own page, so any focus in it counts.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      if (expanded && hasTranscript) setExpanded(false)
      else request('close')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded, hasTranscript])
  // Typing brings the whole chat back. Focus alone does not: the composer takes focus back itself
  // after a send, which would undo the retract the send just caused.
  const onKeyDownCapture = (event: KeyboardEvent): void => {
    if (expanded || event.key === 'Escape' || event.key === 'Enter' || event.ctrlKey || event.metaKey || event.altKey) return
    if ((event.target as Element).tagName === 'TEXTAREA') setExpanded(true)
  }
  // In the compact card, a click anywhere but Send, Stop and the feed's buttons opens the whole chat.
  const onPointerDown = (event: PointerEvent): void => {
    if (expanded) return
    const target = event.target as Element
    if (target.closest('[data-ui="composer.send"], [data-ui="composer.stop"], [data-ui="composer.resume"], .quick-chat-feed-actions')) return
    setExpanded(true)
  }

  const whole = expanded && hasTranscript
  return (
    <div ref={cardRef} className={`quick-chat-card${whole ? ' is-whole' : ' is-compact'}`}
      onKeyDownCapture={onKeyDownCapture} onPointerDownCapture={onPointerDown}>
      {whole ? (
        <div className="quick-chat-header">
          <span className="quick-chat-title" title={title}>{title}</span>
          <button type="button" className="quick-chat-icon-button" data-ui="browser.quick-chat-new"
            title="New quick chat" aria-label="New quick chat" onClick={() => request('new')}>
            <SquarePen size={15} aria-hidden="true" />
          </button>
          <button type="button" className="quick-chat-icon-button" data-ui="browser.quick-chat-compact"
            title="Show the page (Esc)" aria-label="Shrink to the composer" onClick={() => setExpanded(false)}>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
      ) : feed.status !== 'idle' ? (
        <QuickChatFeedView feed={feed} onExpand={() => setExpanded(true)} />
      ) : null}
      <div className="quick-chat-body">
        <WorkspaceChat paneId={paneId} dispatch={dispatch} appearance={appearance} panelVisible={whole}
          onNewChat={() => request('new')} />
      </div>
    </div>
  )
})

function QuickChatFeedView({ feed, onExpand }: { feed: QuickChatFeed; onExpand: () => void }): JSX.Element {
  return (
    <div className={`quick-chat-feed is-${feed.status}`} aria-live="polite">
      <div className="quick-chat-feed-lines">
        {feed.lines.map((line) => (
          <div key={line.id} className={`quick-chat-feed-line is-${line.state}`}>
            {line.state === 'live' ? <Loader2 className="spin" size={12} aria-hidden="true" />
              : line.state === 'failed' ? <AlertCircle size={12} aria-hidden="true" />
                : <Check size={12} aria-hidden="true" />}
            <span>{line.text}</span>
          </div>
        ))}
        {feed.reply ? <p className="quick-chat-feed-reply">{feed.reply}</p> : null}
      </div>
      <div className="quick-chat-feed-actions">
        <button type="button" className="quick-chat-icon-button" data-ui="browser.quick-chat-expand"
          title="Show the whole chat" aria-label="Show the whole chat" onClick={onExpand}>
          <ChevronUp size={16} aria-hidden="true" />
        </button>
        <button type="button" className="quick-chat-icon-button" data-ui="browser.quick-chat-collapse"
          title="Close to the button" aria-label="Close quick chat" onClick={() => request('close')}>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
