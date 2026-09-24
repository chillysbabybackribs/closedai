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
      ? <p className="agent-run-overview-empty">No runs in this workspace yet. Write instructions below and press Start.</p>
      : <div className="agent-run-table-wrap">
        <table className="agent-run-table">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Status</th>
              <th scope="col">Activity</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {tiles.map((tile) => <AgentRunCard key={tile.chatId} tile={tile} onOpenChat={onOpenChat}
              onPause={(id) => api.pause(id)} onResume={(id) => api.resume(id)} onStop={(id) => api.stop(id)} />)}
          </tbody>
        </table>
      </div>}
  </section>
}
