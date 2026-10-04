import type { JSX } from 'react'
import { useMemo } from 'react'

import { Button } from '../../components/ui/button.js'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card.js'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '../../components/ui/empty.js'
import { cn } from '../../lib/utils.js'
import { describeAgentLimits, describeAgentUse, savedAgentStartOptions, type SavedAgent } from '../../shared/agent-library.js'
import type { AgentRun, AgentRunStartOptions } from '../../shared/agent-runs.js'
import { DOCK_STATE_LABEL, dockSummary, type DockTile, type DockTileState } from '../agent-runs/agent-run-overview-model.js'
import { useAgentRunAction } from '../agent-runs/use-agent-run-action.js'
import { AgentScreenHeader } from './agent-screen-header.js'

// The Agents tab's first screen: one card per saved agent with Start on each, and the two ways
// off it (Runs, New agent). The pure helpers decide card order and which live run a card shows.

/** The most pressing live run per saved agent, keyed by agent id; `tiles` arrive urgency-first. */
export function liveTilesByAgent(runs: readonly Pick<AgentRun, 'chatId' | 'agentId'>[], tiles: readonly DockTile[]): Map<string, DockTile> {
  const agentByChat = new Map(runs.map((run) => [run.chatId, run.agentId]))
  const live = new Map<string, DockTile>()
  for (const tile of tiles) {
    const agentId = agentByChat.get(tile.chatId)
    if (agentId && !live.has(agentId)) live.set(agentId, tile)
  }
  return live
}

/** Live runs first (in their urgency order), then most recently used, then never-run by name. */
export function orderAgents(agents: readonly SavedAgent[], live: ReadonlyMap<string, DockTile>): SavedAgent[] {
  const liveRank = new Map([...live.keys()].map((id, index) => [id, index]))
  return [...agents].sort((a, b) => {
    const rankA = liveRank.get(a.id) ?? Number.POSITIVE_INFINITY
    const rankB = liveRank.get(b.id) ?? Number.POSITIVE_INFINITY
    if (rankA !== rankB) return rankA - rankB
    const usedA = a.lastRunAt ?? 0
    const usedB = b.lastRunAt ?? 0
    if (usedA !== usedB) return usedB - usedA
    return a.name.localeCompare(b.name)
  })
}

/** The Runs control's label: the run summary rides along once there is anything to summarize. */
export function runsLabel(tiles: readonly DockTile[]): string {
  return tiles.length === 0 ? 'Runs' : `Runs · ${dockSummary(tiles)}`
}

const LIVE_TONE: Record<DockTileState, string> = {
  running: 'text-(--ok-ink)',
  retrying: 'text-(--ok-ink)',
  paused: 'text-muted-foreground',
  finished: 'text-(--link-ink)',
  approval: 'text-(--link-ink)',
  review: 'text-(--link-ink)',
  failed: 'text-destructive'
}

export type AgentLibraryCardsProps = {
  agents: readonly SavedAgent[]
  tiles: readonly DockTile[]
  live: ReadonlyMap<string, DockTile>
  now: number
  /** False while the launching pane cannot start a run (provider unavailable). */
  startEnabled: boolean
  onNew: () => void
  onEdit: (agent: SavedAgent) => void
  onRuns: () => void
  onStart: (options: AgentRunStartOptions) => Promise<void>
}

export function AgentLibraryCards({ agents, tiles, live, now, startEnabled, onNew, onEdit, onRuns, onStart }: AgentLibraryCardsProps): JSX.Element {
  const ordered = useMemo(() => orderAgents(agents, live), [agents, live])
  const attention = tiles.some((tile) => tile.attentionKey !== null)
  return (
    <div className="agent-screen">
      <AgentScreenHeader title="Agents">
        <Button type="button" variant="ghost" size="xs" data-ui="agents.runs" className={cn(attention && 'text-(--link-ink)')} onClick={onRuns}>
          {runsLabel(tiles)}
        </Button>
        {agents.length > 0 && <Button type="button" size="xs" data-ui="agents.new" onClick={onNew}>New agent</Button>}
      </AgentScreenHeader>
      {agents.length === 0 ? (
        <Empty className="agent-library-empty">
          <EmptyHeader>
            <EmptyTitle className="text-sm font-semibold">No saved agents</EmptyTitle>
            <EmptyDescription className="text-xs">Build one and Save to keep it here.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" size="xs" data-ui="agents.new" onClick={onNew}>New agent</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="agent-card-grid" role="list" aria-label="Saved agents">
          {ordered.map((agent) => (
            <AgentCard key={agent.id} agent={agent} live={live.get(agent.id) ?? null} now={now} startEnabled={startEnabled}
              onEdit={() => onEdit(agent)} onStart={onStart} />
          ))}
        </div>
      )}
    </div>
  )
}

function AgentCard({ agent, live, now, startEnabled, onEdit, onStart }: {
  agent: SavedAgent
  live: DockTile | null
  now: number
  startEnabled: boolean
  onEdit: () => void
  onStart: (options: AgentRunStartOptions) => Promise<void>
}): JSX.Element {
  const { busy, error, act } = useAgentRunAction()
  const limits = [describeAgentLimits(agent), agent.autonomous ? '' : 'supervised'].filter(Boolean).join(' · ')
  const status = live
    ? [DOCK_STATE_LABEL[live.state], live.cycleLabel, live.timeLabel].filter(Boolean).join(' · ')
    : `${describeAgentUse(agent, now)}${limits ? ` · ${limits}` : ''}`
  const tone = error ? 'text-destructive' : live ? LIVE_TONE[live.state] : 'text-muted-foreground'
  const start = (): Promise<void> => act(() => onStart(savedAgentStartOptions(agent)))
  return (
    <Card role="listitem" data-ui="agents.card" data-ui-key={agent.id} data-live={live?.state}
      className="agent-card gap-3 rounded-lg py-3 shadow-none">
      <CardHeader className="gap-1 px-4">
        <CardTitle className="agent-card-title" title={agent.name}>{agent.name}</CardTitle>
        <CardDescription className="agent-card-description line-clamp-2 text-xs">{agent.description || agent.prompt}</CardDescription>
      </CardHeader>
      <CardFooter className="agent-card-footer gap-1.5 px-4">
        <span className={cn('agent-card-status', tone)} title={error || status} role={error ? 'alert' : undefined}>{error || status}</span>
        <Button type="button" variant="ghost" size="xs" data-ui="agents.edit" data-ui-key={agent.id} disabled={busy} onClick={onEdit}>Edit</Button>
        <Button type="button" size="xs" data-ui="agents.card-start" data-ui-key={agent.id} disabled={busy || !startEnabled}
          title={startEnabled ? undefined : 'Select a chat that can start runs first'} onClick={() => void start()}>
          {busy ? 'Starting…' : 'Start'}
        </Button>
      </CardFooter>
    </Card>
  )
}
