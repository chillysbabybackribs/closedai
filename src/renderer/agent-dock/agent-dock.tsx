import { useEffect, useMemo, useState, type JSX } from 'react'
import { Plus } from 'lucide-react'
import { HeroDockBar, HeroDockIcon, HeroDockSeparator } from '../../components/ui/hero-dock.js'
import { cn } from '../../lib/utils.js'
import type { CredentialApprovalRequest } from '../../shared/security.js'
import { useAgentRuns } from '../agent-runs/agent-runs-store.js'
import { securityRequests } from '../security-requests.js'
import { dockSummary, dockTiles, type DockChatActivity } from './agent-dock-model.js'
import { AgentDockIcon } from './agent-dock-icon.js'

// The dock overlays the workspace on bottom-edge hover or keyboard focus.
// Keep it revealed while a portaled run card is open.

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
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [openRun, setOpenRun] = useState<string | null>(null)
  const runs = useAgentRuns()
  const approvals = useCredentialApprovals()
  const tiles = useMemo(() => dockTiles(runs, chats, approvals), [runs, chats, approvals])
  const needsUser = tiles.some((tile) => tile.attentionKey !== null)
  const revealed = hovered || focused || tiles.some((tile) => tile.chatId === openRun)
  const runsApi = window.closedai.agentRuns

  return (
    <footer className="agent-dock"
      data-ui="dock.bar" aria-label="Agents" data-state={revealed ? 'open' : 'closed'}
      onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
      <span className="agent-dock-edge" aria-hidden="true" />
      <HeroDockBar>
        <p role="status" className="agent-dock-summary">
          <span className="font-medium text-foreground">Agents</span>
          <span className={cn('agent-dock-summary-detail', needsUser ? 'text-(--link-ink)' : 'text-muted-foreground')}>{dockSummary(tiles)}</span>
        </p>
        {tiles.map((tile) => (
          <AgentDockIcon key={tile.chatId} tile={tile} onOpenChange={(open) => setOpenRun(open ? tile.chatId : null)} onOpenChat={onOpenChat}
            onPause={(id) => runsApi.pause(id)} onResume={(id) => runsApi.resume(id)} onStop={(id) => runsApi.stop(id)} />
        ))}
        {tiles.length > 0 && <HeroDockSeparator />}
        <HeroDockIcon icon={Plus} label="New agent" aria-label="New or saved agent" data-ui="dock.agents" onClick={onOpenAgents} />
      </HeroDockBar>
    </footer>
  )
}
