import { useEffect, useMemo, useState, type JSX } from 'react'
import { Plus } from 'lucide-react'
import { HeroDockBar, HeroDockIcon, HeroDockSeparator } from '../../components/ui/hero-dock.js'
import { cn } from '../../lib/utils.js'
import type { CredentialApprovalRequest } from '../../shared/security.js'
import { useAgentRuns } from '../agent-runs/agent-runs-store.js'
import { securityRequests } from '../security-requests.js'
import { dockSummary, dockTiles, type DockChatActivity } from './agent-dock-model.js'
import { AgentDockIcon } from './agent-dock-icon.js'

// The agent dock: a hero dock bar under the workspace, sitting on the window chassis with no rail
// behind it, one tile per agent run plus a new-agent tile, with a status inside the pill. It is always on
// screen, so a run that needs the user shows it here without opening anything over the work.

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
  const needsUser = tiles.some((tile) => tile.attentionKey !== null)
  const runsApi = window.closedai.agentRuns

  return (
    <footer className="agent-dock"
      data-ui="dock.bar" aria-label="Agents">
      <HeroDockBar>
      <p role="status" className="agent-dock-summary">
        <span className="font-medium text-foreground">Agents</span>
        <span className={cn('agent-dock-summary-detail', needsUser ? 'text-(--link-ink)' : 'text-muted-foreground')}>{dockSummary(tiles)}</span>
      </p>
        {tiles.map((tile) => (
          <AgentDockIcon key={tile.chatId} tile={tile} onOpenChat={onOpenChat}
            onPause={(id) => runsApi.pause(id)} onResume={(id) => runsApi.resume(id)} onStop={(id) => runsApi.stop(id)} />
        ))}
        {tiles.length > 0 && <HeroDockSeparator />}
        <HeroDockIcon icon={Plus} label="New agent" aria-label="New or saved agent" data-ui="dock.agents" onClick={onOpenAgents} />
      </HeroDockBar>
    </footer>
  )
}
