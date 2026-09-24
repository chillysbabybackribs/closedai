import type { JSX } from 'react'
import { useEffect } from 'react'
import { ChevronDown, Users } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js'
import { cn } from '../lib/utils.js'
import type { SavedAgent } from '../shared/agent-library.js'
import type { AgentRunStartOptions } from '../shared/agent-runs.js'
import { useAgentLibrary } from './agent-library/agent-library-store.js'
import { liveTilesByAgent, orderAgents } from './agent-library/agent-library-cards.js'
import { useAgentRuns } from './agent-runs/agent-runs-store.js'
import { dockTiles, DOCK_STATE_LABEL } from './agent-runs/agent-run-overview-model.js'
import { useAgentRunAction } from './agent-runs/use-agent-run-action.js'

export type ComposerAgentsMenuProps = {
  paneId: string
  startEnabled: boolean
  runningTurn: boolean
  onStart: (paneId: string, options: AgentRunStartOptions) => Promise<void>
  onOpenRun: (chatId: string) => Promise<void>
  onManage: (paneId: string) => void
  onError: (message: string) => void
}

/** Saved-agent quick start for this chat's tile; Manage opens the workspace Agents view. */
export function ComposerAgentsMenu({ paneId, startEnabled, runningTurn, onStart, onOpenRun, onManage, onError }: ComposerAgentsMenuProps): JSX.Element {
  const agents = useAgentLibrary()
  const runs = useAgentRuns()
  const live = liveTilesByAgent(runs, dockTiles(runs, [], [], Date.now()))
  const ordered = orderAgents(agents, live)
  const runningCount = runs.filter((run) => run.status === 'running').length
  const { busy, error, act } = useAgentRunAction()
  const disabled = !startEnabled || runningTurn || busy
  useEffect(() => {
    if (error) onError(error)
  }, [error, onError])

  const openOrStart = (agent: SavedAgent, liveChatId: string | undefined): void => {
    void act(async () => {
      if (liveChatId) {
        await onOpenRun(liveChatId)
        return
      }
      await onStart(paneId, {
        prompt: agent.prompt,
        maxCycles: agent.maxCycles,
        agentId: agent.id,
        name: agent.name
      })
    })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn('composer-pill', runningCount > 0 && 'composer-pill-attention')}
          data-ui="composer.agents"
          disabled={runningTurn}
          aria-haspopup="menu"
        >
          <Users size={14} strokeWidth={1.9} aria-hidden="true" />
          <span className="composer-pill-label">Agents{runningCount > 0 ? ` · ${runningCount}` : ''}</span>
          <ChevronDown className="composer-pill-chevron" size={11} strokeWidth={2} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="composer-agents-panel" align="start" side="top" sideOffset={8}>
        <p className="composer-agents-heading">Start beside this chat</p>
        {ordered.length === 0 ? (
          <p className="composer-agents-empty">No saved agents yet.</p>
        ) : (
          <ul className="composer-agents-list" role="menu">
            {ordered.map((agent) => {
              const liveTile = live.get(agent.id)
              return (
                <li key={agent.id}>
                  <button
                    type="button"
                    role="menuitem"
                    className="composer-agents-item"
                    data-ui="composer.agents-start"
                    data-ui-key={agent.id}
                    disabled={disabled}
                    title={disabled && !startEnabled ? 'This chat cannot start an agent right now' : undefined}
                    onClick={() => openOrStart(agent, liveTile?.chatId)}
                  >
                    <span className="composer-agents-item-name">{agent.name}</span>
                    <span className="composer-agents-item-meta">
                      {liveTile ? `Open · ${liveTile.cycleLabel} · ${DOCK_STATE_LABEL[liveTile.state]}` : 'Start run'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <div className="composer-agents-foot">
          <button type="button" className="composer-agents-manage" data-ui="composer.agents-manage" onClick={() => onManage(paneId)}>
            Manage agents…
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
