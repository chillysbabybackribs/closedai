import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type JSX, type ReactNode } from 'react'
import { AlertCircle, Check, Ellipsis, Loader2, Maximize2, Minimize2, Pause, X } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger
} from '../../components/ui/dropdown-menu.js'
import { chatRunning, initialChatState, type ChatWorkspaceAction } from '../chat-state.js'
import { WorkspaceChat } from '../chat-layout/workspace-chat.js'
import { useWorkspacePaneSlice } from '../chat-layout/workspace-pane-subscription.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'
import { feedLead, quickChatFeed, type QuickChatFeed } from './quick-chat-feed.js'

const request = (value: 'new' | 'close'): void => { void window.closedai.quickChat.request(value) }

type Mode = 'full' | 'compact'

// The shape the user last chose for each chat, so hiding and reopening it keeps that shape.
const chosenMode = new Map<string, Mode>()

/**
 * The open quick chat: the whole chat, or the compact composer under a one-line status. It changes
 * shape only when the user presses shrink or expand; sending, clicks on the page and typing leave
 * it as it is.
 */
export const QuickChatCard = memo(function QuickChatCard({ paneId, site, dispatch, appearance }: {
  paneId: string
  /** The site the browser shows, for "Working on espn.com". */
  site: string | null
  dispatch: Dispatch<ChatWorkspaceAction>
  appearance: AppearanceSettings
}): JSX.Element {
  const slice = useWorkspacePaneSlice(paneId)
  const state = slice.state ?? initialChatState()
  const running = chatRunning(state)
  const hasTranscript = state.items.length > 0
  const title = slice.chats.find((row) => row.paneId === paneId)?.title ?? 'New chat'
  const feed = useMemo(() => quickChatFeed(state, 1), [state])
  const [mode, setModeState] = useState<Mode>(() => chosenMode.get(paneId) ?? 'full')
  const setMode = (next: Mode): void => { chosenMode.set(paneId, next); setModeState(next) }
  const cardRef = useRef<HTMLDivElement>(null)

  // Opening lands in the composer.
  useEffect(() => {
    cardRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [])

  // Escape hides the chat. Menus and panels inside the layer take their own Escape first.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      request('close')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const whole = mode === 'full' || !hasTranscript
  return (
    <div ref={cardRef} className={`quick-chat-card${whole ? ' is-whole' : ' is-compact'}`}>
      {whole ? (
        <div className="quick-chat-header">
          <span className="quick-chat-title" title={title}>{title}</span>
          {hasTranscript ? (
            <IconButton control="browser.quick-chat-compact" label="Shrink to the status line"
              onClick={() => setMode('compact')}><Minimize2 size={14} aria-hidden="true" /></IconButton>
          ) : null}
          <QuickChatMenu running={running} />
          <CloseButton />
        </div>
      ) : (
        <QuickChatStatus feed={feed} site={site} onExpand={() => setMode('full')} />
      )}
      <div className="quick-chat-body">
        <WorkspaceChat paneId={paneId} dispatch={dispatch} appearance={appearance} panelVisible={whole}
          onNewChat={() => request('new')} />
      </div>
    </div>
  )
})

/** One line: what the task is doing and where, with the reply under it once the task ends. */
function QuickChatStatus({ feed, site, onExpand }: { feed: QuickChatFeed; site: string | null; onExpand: () => void }): JSX.Element {
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
        <IconButton control="browser.quick-chat-expand" label="Show the whole chat" onClick={onExpand}>
          <Maximize2 size={14} aria-hidden="true" />
        </IconButton>
        <CloseButton />
      </div>
      {feed.status !== 'working' && feed.reply ? <p className="quick-chat-status-reply">{feed.reply}</p> : null}
    </div>
  )
}

function QuickChatMenu({ running }: { running: boolean }): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="quick-chat-icon-button" data-ui="browser.quick-chat-menu" title="More" aria-label="More">
          <Ellipsis size={16} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[240px]">
        <DropdownMenuItem data-ui="browser.quick-chat-new" disabled={running} onSelect={() => request('new')}>
          Clear chat
        </DropdownMenuItem>
        <DropdownMenuLabel className="whitespace-normal font-normal">
          {running ? 'Stop the task first.' : 'Starts a new chat. This one stays in History.'}
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CloseButton(): JSX.Element {
  return (
    <IconButton control="browser.quick-chat-close" label="Hide to the button (Ctrl+J)" onClick={() => request('close')}>
      <X size={15} aria-hidden="true" />
    </IconButton>
  )
}

function IconButton({ control, label, onClick, children }: { control: string; label: string; onClick: () => void; children: ReactNode }): JSX.Element {
  return (
    <button type="button" className="quick-chat-icon-button" data-ui={control} title={label} aria-label={label} onClick={onClick}>
      {children}
    </button>
  )
}
