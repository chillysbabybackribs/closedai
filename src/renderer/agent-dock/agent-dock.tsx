import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Bot, Pin, PinOff } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import type { CredentialApprovalRequest } from '../../shared/security.js'
import { useAgentRuns } from '../agent-runs/agent-runs-store.js'
import { securityRequests } from '../security-requests.js'
import {
  DOCK_CLOSED, dockSummary, dockTiles, dockVisible, reduceDock,
  type DockChatActivity, type DockEvent
} from './agent-dock-model.js'
import { AgentDockTile } from './agent-dock-tile.js'

// The agent dock: a rail along the bottom edge with one dot per run, and a panel of run tiles
// above it. Resting on the rail or clicking it opens the panel; a run that needs the user opens
// it without either. Runs keep going whether or not the dock or their chat is on screen.

/** A rest this long on the rail opens the dock; a pass over it on the way to a composer does not. */
export const DOCK_DWELL_MS = 350
/** The pointer may leave the dock this long (a diagonal to the rail, a tooltip) before it closes. */
export const DOCK_LEAVE_MS = 450

export type AgentDockProps = {
  chats: readonly DockChatActivity[]
  onOpenChat: (chatId: string) => void
  onOpenAgents: () => void
}

function useCredentialApprovals(): CredentialApprovalRequest[] {
  const [pending, setPending] = useState<CredentialApprovalRequest[]>([])
  useEffect(() => securityRequests().credentials.subscribe(setPending), [])
  return pending
}

export function AgentDock({ chats, onOpenChat, onOpenAgents }: AgentDockProps): JSX.Element {
  const runs = useAgentRuns()
  const approvals = useCredentialApprovals()
  const tiles = useMemo(() => dockTiles(runs, chats, approvals), [runs, chats, approvals])
  const attention = useMemo(() => tiles.flatMap((tile) => tile.attentionKey ? [tile.attentionKey] : []), [tiles])
  const attentionRef = useRef(attention)
  attentionRef.current = attention
  const [reveal, setReveal] = useState(DOCK_CLOSED)
  const dispatch = useCallback((event: DockEvent) => setReveal((current) => reduceDock(current, event, attentionRef.current)), [])
  const visible = dockVisible(reveal, attention)
  const summary = dockSummary(tiles)

  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A rest opens the dock a moment before the click the user was already making; that click
  // should not close what just opened.
  const dwellOpenedAt = useRef(0)
  const clear = (timer: typeof dwell): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => () => { clear(dwell); clear(leave) }, [])
  useEffect(() => {
    if (!visible) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) dispatch({ type: 'escape' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, dispatch])

  const openChat = (chatId: string): void => {
    dispatch({ type: 'escape' })
    onOpenChat(chatId)
  }
  const runsApi = window.closedai.agentRuns

  return (
    <div className="agent-dock" data-open={visible ? 'yes' : 'no'}
      onPointerEnter={() => clear(leave)}
      onPointerLeave={() => {
        clear(dwell)
        clear(leave)
        leave.current = setTimeout(() => dispatch({ type: 'leave' }), DOCK_LEAVE_MS)
      }}>
      {visible && (
        <section className="agent-dock-panel" role="dialog" aria-modal="false" aria-label="Agents dock" data-ui="dock.panel"
          onPointerEnter={() => dispatch({ type: 'look' })} onFocus={() => dispatch({ type: 'look' })}>
          <header className="flex items-center gap-3 px-1">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">Agents</h2>
              <p className="agent-dock-summary truncate text-xs">{summary}</p>
            </div>
            <Button type="button" variant="outline" size="sm" data-ui="dock.agents"
              onClick={() => { dispatch({ type: 'escape' }); onOpenAgents() }}>
              <Bot /> New or saved agent
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" data-ui="dock.pin" aria-pressed={reveal.pinned}
              aria-label={reveal.pinned ? 'Unpin the dock' : 'Pin the dock open'} title={reveal.pinned ? 'Unpin' : 'Keep open'}
              onClick={() => dispatch({ type: 'pin' })}>
              {reveal.pinned ? <PinOff /> : <Pin />}
            </Button>
          </header>
          {tiles.length === 0 ? (
            <p className="agent-dock-empty text-sm">
              Nothing is running. Start a saved agent, or write a new one, and it runs here without taking a pane.
            </p>
          ) : (
            <div className="agent-dock-tiles">
              {tiles.map((tile) => (
                <AgentDockTile key={tile.chatId} tile={tile} onOpenChat={openChat}
                  onPause={(id) => runsApi.pause(id)} onResume={(id) => runsApi.resume(id)} onStop={(id) => runsApi.stop(id)} />
              ))}
            </div>
          )}
        </section>
      )}
      <button type="button" className="agent-dock-rail" data-ui="dock.rail" aria-expanded={visible}
        aria-label={`Agents dock: ${summary}`} title={summary}
        onPointerEnter={() => {
          clear(dwell)
          if (!visible) dwell.current = setTimeout(() => { dwellOpenedAt.current = Date.now(); dispatch({ type: 'open' }) }, DOCK_DWELL_MS)
        }}
        onPointerLeave={() => clear(dwell)}
        onClick={() => {
          clear(dwell)
          if (Date.now() - dwellOpenedAt.current > DOCK_DWELL_MS * 2) dispatch({ type: 'toggle' })
        }}>
        {tiles.map((tile) => <span key={tile.chatId} className="agent-dock-dot" data-state={tile.state} aria-hidden="true" />)}
      </button>
    </div>
  )
}
