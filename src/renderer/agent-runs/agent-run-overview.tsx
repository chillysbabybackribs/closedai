import type { JSX } from 'react'
import { Button } from '../../components/ui/button.js'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '../../components/ui/empty.js'
import { AgentRunCard } from './agent-run-card.js'
import type { DockTile } from './agent-run-overview-model.js'

// The Runs screen body of the Agents tab: every run as a table row, urgency-first, or an empty
// state that sends the user to build an agent. The view owns the header and the run store.

export type AgentRunOverviewProps = {
  tiles: readonly DockTile[]
  onOpenChat: (chatId: string) => void
  onNewAgent: () => void
  onPause: (chatId: string) => Promise<unknown>
  onResume: (chatId: string) => Promise<unknown>
  onStop: (chatId: string) => Promise<unknown>
}

export function AgentRunOverview({ tiles, onOpenChat, onNewAgent, onPause, onResume, onStop }: AgentRunOverviewProps): JSX.Element {
  if (tiles.length === 0) {
    return <Empty className="agent-library-empty" aria-label="Agent runs">
      <EmptyHeader>
        <EmptyTitle className="text-sm font-semibold">No runs yet</EmptyTitle>
        <EmptyDescription className="text-xs">Start a saved agent from the Library, or build a new one.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" size="xs" data-ui="agents.new" onClick={onNewAgent}>New agent</Button>
      </EmptyContent>
    </Empty>
  }
  return <div className="agent-run-table-wrap" aria-label="Agent runs">
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
          onPause={onPause} onResume={onResume} onStop={onStop} />)}
      </tbody>
    </table>
  </div>
}
