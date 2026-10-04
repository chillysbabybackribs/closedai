import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type JSX, type ReactNode } from 'react'
import { AlertCircle, Check, Ellipsis, Loader2, Maximize2, Minimize2, Pause, X } from '../icons/index.js'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger
} from '../../components/ui/dropdown-menu.js'
import { chatRunning, initialChatState, type ChatWorkspaceAction } from '../chat-state.js'
import { WorkspaceChat } from '../chat-layout/workspace-chat.js'
import { useWorkspacePaneSlice } from '../chat-layout/workspace-pane-subscription.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'
import type { QuickChatSurface } from '../../shared/quick-chat-overlay.js'
import { feedLead, quickChatFeed, type QuickChatFeed } from './quick-chat-feed.js'
import { formatRunSeconds, useRunSeconds } from './run-clock.js'

export type QuickChatRequest = 'new' | 'close'
export type QuickChatMode = 'full' | 'compact'
export type { QuickChatSurface }
type Mode = QuickChatMode

// The shape the user last chose for each chat, so hiding and reopening it keeps that shape.
const chosenMode = new Map<string, Mode>()

/**
 * The open quick chat: the whole chat, or the compact composer under a one-line status. It changes
 * shape only when the user presses shrink or expand; sending, clicks on the page and typing leave
 * it as it is.
 */
export const QuickChatCard = memo(function QuickChatCard({
  paneId, site, dispatch, appearance, surface = 'notepad', onRequest, mode: controlledMode, onModeChange
}: {
  paneId: string
  /** What the task works on: the site the browser shows, or the note, for "Working on espn.com". */
  site: string | null
  dispatch: Dispatch<ChatWorkspaceAction>
  appearance: AppearanceSettings
  surface?: QuickChatSurface
  /** Hide or clear the chat; the notepad host handles requests in place. */
  onRequest: (request: QuickChatRequest) => void
  /** Set by a host that changes the shape itself (a notepad compacts on a tab switch mid-task). */
  mode?: QuickChatMode
  onModeChange?: (mode: QuickChatMode) => void
}): JSX.Element {
  const slice = useWorkspacePaneSlice(paneId)
  const state = slice.state ?? initialChatState()
  const running = chatRunning(state)
  const hasTranscript = state.items.length > 0
  const title = slice.chats.find((row) => row.paneId === paneId)?.title ?? 'New chat'
  const feed = useMemo(() => quickChatFeed(state, 1), [state])
  const seconds = useRunSeconds(paneId, running)
  const [ownMode, setModeState] = useState<Mode>(() => chosenMode.get(paneId) ?? 'full')
  const mode = controlledMode ?? ownMode
  const setMode = (next: Mode): void => {
    chosenMode.set(paneId, next)
    setModeState(next)
    onModeChange?.(next)
  }
  const requestRef = useRef(onRequest)
  requestRef.current = onRequest
  const cardRef = useRef<HTMLDivElement>(null)

  // Opening lands in the composer.
  useEffect(() => {
    cardRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [])

  // Escape hides the chat. Menus and panels inside the layer take their own Escape first; in the
  // app window, where other tiles take keys too, only an Escape from inside the card counts.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (!(event.target instanceof Node && cardRef.current?.contains(event.target))) return
      event.preventDefault()
      requestRef.current('close')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [surface])

  const whole = mode === 'full' || !hasTranscript
  const close = (): void => onRequest('close')
  return (
    <div ref={cardRef} className={`quick-chat-card${whole ? ' is-whole' : ' is-compact'}`} data-surface={surface}>
      {whole ? (
        <div className={`quick-chat-header${running ? ' is-running' : ''}`}>
          {running ? <Loader2 className="quick-chat-working-icon spin" size={14} aria-hidden="true" /> : null}
          <span className="quick-chat-title" title={title}>{title}</span>
          {running ? <WorkingText feed={feed} seconds={seconds} /> : null}
          {hasTranscript ? (
            <IconButton control="quick-chat.compact" surface={surface} label="Shrink to the status line"
              onClick={() => setMode('compact')}><Minimize2 size={14} aria-hidden="true" /></IconButton>
          ) : null}
          <QuickChatMenu running={running} surface={surface} onClear={() => onRequest('new')} />
          <CloseButton surface={surface} onClose={close} />
        </div>
      ) : (
        <QuickChatStatus feed={feed} site={site} seconds={seconds} surface={surface} onExpand={() => setMode('full')} onClose={close} />
      )}
      <div className="quick-chat-body">
        <WorkspaceChat paneId={paneId} dispatch={dispatch} appearance={appearance} panelVisible={whole} />
      </div>
    </div>
  )
})

/**
 * The whole card's header while its task runs: the step under way ("Thinking", "Opening espn.com")
 * and how long the task has run, so a quiet stretch still reads as working.
 */
function WorkingText({ feed, seconds }: { feed: QuickChatFeed; seconds: number | null }): JSX.Element {
  const step = feed.lines.at(-1)?.text ?? 'Working'
  return (
    <span className="quick-chat-working" role="status" title={step}>
      <span className="quick-chat-working-step">{step}</span>
      {seconds !== null ? <span className="quick-chat-working-time" aria-hidden="true">{formatRunSeconds(seconds)}</span> : null}
    </span>
  )
}

/** One line: what the task is doing and where, with the reply under it once the task ends. */
function QuickChatStatus({ feed, site, seconds, surface, onExpand, onClose }: {
  feed: QuickChatFeed
  site: string | null
  seconds: number | null
  surface: QuickChatSurface
  onExpand: () => void
  onClose: () => void
}): JSX.Element {
  const { lead, where } = feedLead(feed.status, site)
  const step = feed.status === 'working' ? feed.lines.at(-1) : undefined
  const detail = step && step.id !== 'working' ? ` · ${step.text}` : ''
  const icon = feed.status === 'working' ? <Loader2 className="spin" size={13} aria-hidden="true" />
    : feed.status === 'failed' ? <AlertCircle size={13} aria-hidden="true" />
      : feed.status === 'paused' ? <Pause size={13} aria-hidden="true" />
        : <Check size={13} aria-hidden="true" />
  return (
    <div className={`quick-chat-status is-${feed.status}`} aria-live="polite">
      <div className="quick-chat-status-line">
        <span className="quick-chat-status-icon">{icon}</span>
        <span className="quick-chat-status-text">{lead} <b>{where}</b>{detail}</span>
        {feed.status === 'working' && seconds !== null ? (
          <span className="quick-chat-working-time" aria-hidden="true">{formatRunSeconds(seconds)}</span>
        ) : null}
        <IconButton control="quick-chat.expand" surface={surface} label="Show the whole chat" onClick={onExpand}>
          <Maximize2 size={14} aria-hidden="true" />
        </IconButton>
        <CloseButton surface={surface} onClose={onClose} />
      </div>
      {feed.status !== 'working' && feed.reply ? <p className="quick-chat-status-reply">{feed.reply}</p> : null}
    </div>
  )
}

function QuickChatMenu({ running, surface, onClear }: { running: boolean; surface: QuickChatSurface; onClear: () => void }): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="quick-chat-icon-button" data-ui="quick-chat.menu" data-ui-key={surface} title="More" aria-label="More">
          <Ellipsis size={16} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[240px]">
        <DropdownMenuItem data-ui="quick-chat.new" data-ui-key={surface} disabled={running} onSelect={onClear}>
          Clear chat
        </DropdownMenuItem>
        <DropdownMenuLabel className="whitespace-normal font-normal">
          {running ? 'Stop the task first.' : 'Starts a new chat. This one stays in History.'}
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CloseButton({ surface, onClose }: { surface: QuickChatSurface; onClose: () => void }): JSX.Element {
  return (
    <IconButton control="quick-chat.close" surface={surface} label="Hide to the button (Ctrl+J)" onClick={onClose}>
      <X size={15} aria-hidden="true" />
    </IconButton>
  )
}

function IconButton({ control, surface, label, onClick, children }: {
  control: string; surface: QuickChatSurface; label: string; onClick: () => void; children: ReactNode
}): JSX.Element {
  return (
    <button type="button" className="quick-chat-icon-button" data-ui={control} data-ui-key={surface} title={label} aria-label={label} onClick={onClick}>
      {children}
    </button>
  )
}
