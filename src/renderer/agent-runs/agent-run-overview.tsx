import { useEffect, useMemo, useState, type JSX } from 'react'
import type { CredentialApprovalRequest } from '../../shared/security.js'
import { securityRequests } from '../security-requests.js'
import { useAgentRuns } from './agent-runs-store.js'
import { AgentRunCard } from './agent-run-card.js'
import { dockSummary, dockTiles, type DockChatActivity } from './agent-run-overview-model.js'

export function AgentRunOverview({ chats, onOpenChat }: {
  chats: readonly DockChatActivity[]
  onOpenChat: (chatId: string) => void
}): JSX.Element {
  const runs = useAgentRuns()
  const [approvals, setApprovals] = useState<CredentialApprovalRequest[]>([])
  useEffect(() => securityRequests().credentials.subscribe(setApprovals), [])
  const tiles = useMemo(() => dockTiles(runs, chats, approvals), [runs, chats, approvals])
  const api = window.closedai.agentRuns

  return <section className="agent-run-overview" aria-label="Agent runs">
    <div className="agent-run-overview-heading">
      <h3>Runs</h3>
      <span role="status">{dockSummary(tiles)}</span>
    </div>
    {tiles.length === 0
      ? <p className="agent-run-overview-empty">No agent runs yet. Start one from a saved agent or a new draft.</p>
      : <div className="agent-run-overview-list">
        {tiles.map((tile) => <AgentRunCard key={tile.chatId} tile={tile} onOpenChat={onOpenChat}
          onPause={(id) => api.pause(id)} onResume={(id) => api.resume(id)} onStop={(id) => api.stop(id)} />)}
      </div>}
  </section>
}
