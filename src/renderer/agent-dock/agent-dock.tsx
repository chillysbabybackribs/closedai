import { useEffect, useMemo, useState, type JSX } from 'react'
import { Plus } from 'lucide-react'
import { Dock, DockIcon } from '../../components/ui/dock.js'
import { Separator } from '../../components/ui/separator.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip.js'
import { cn } from '../../lib/utils.js'
import type { CredentialApprovalRequest } from '../../shared/security.js'
import { useAgentRuns } from '../agent-runs/agent-runs-store.js'
import { securityRequests } from '../security-requests.js'
import { dockSummary, dockTiles, type DockChatActivity } from './agent-dock-model.js'
import { AgentDockIcon } from './agent-dock-icon.js'

// The agent dock: a full-width footer row under the workspace holding a Magic UI Dock, one icon
// per agent run plus a new-agent icon, with a one-line status on the left. It is always on
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
    <footer className="agent-dock grid h-11 grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-border bg-(--titlebar-surface) px-3 text-xs"
      data-ui="dock.bar" aria-label="Agents">
      <p role="status" className="truncate">
        <span className="font-medium text-foreground">Agents</span>
        <span className={cn('ml-2', needsUser ? 'text-(--link-ink)' : 'text-muted-foreground')}>{dockSummary(tiles)}</span>
      </p>
      <TooltipProvider>
        <Dock iconSize={28} iconMagnification={40} iconDistance={100}
          className="mx-0 mt-0 h-full gap-1.5 rounded-none border-0 p-0 backdrop-blur-none">
          {tiles.map((tile) => (
            <DockIcon key={tile.chatId} className="relative">
              <AgentDockIcon tile={tile} onOpenChat={onOpenChat}
                onPause={(id) => runsApi.pause(id)} onResume={(id) => runsApi.resume(id)} onStop={(id) => runsApi.stop(id)} />
            </DockIcon>
          ))}
          {tiles.length > 0 && <Separator orientation="vertical" className="my-2 h-auto self-stretch" />}
          <DockIcon className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" data-ui="dock.agents" aria-label="New or saved agent" onClick={onOpenAgents}
                  className="absolute inset-0 flex items-center justify-center rounded-full border border-dashed border-border text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  <Plus className="size-1/2" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">New or saved agent</TooltipContent>
            </Tooltip>
          </DockIcon>
        </Dock>
      </TooltipProvider>
      <span aria-hidden="true" />
    </footer>
  )
}
