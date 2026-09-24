import type { JSX } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { ChevronDown, Users } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js'
import { cn } from '../lib/utils.js'
import type { SavedAgent } from '../shared/agent-library.js'
import type { AgentRunStartOptions } from '../shared/agent-runs.js'
import { useWorkspacePaneActions } from './chat-layout/workspace-pane-actions.js'
import { useAgentLibrary } from './agent-library/agent-library-store.js'
import { liveTilesByAgent, orderAgents } from './agent-library/agent-library-cards.js'
import { useAgentRuns } from './agent-runs/agent-runs-store.js'
import { dockTiles, DOCK_STATE_LABEL, type DockTileState } from './agent-runs/agent-run-overview-model.js'
import { queueAgentsViewIntent } from './agent-library/agents-view-intent.js'
import { useAgentRunAction } from './agent-runs/use-agent-run-action.js'

export type ComposerAgentsMenuProps = {
  paneId: string
  startEnabled: boolean
  runningTurn: boolean
  onStart: (paneId: string, options: AgentRunStartOptions) => Promise<void>
  onOpenRun: (chatId: string) => Promise<void>
  onManage: (paneId: string) => void
  onNewAgent: (paneId: string) => void
  onError: (message: string) => void
}

const OPEN_EXISTING: ReadonlySet<DockTileState> = new Set(['running', 'retrying', 'approval'])

/** Saved-agent picker scoped to one chat pane; at most one pane shows it open. */
export function ComposerAgentsMenu({ paneId, startEnabled, runningTurn, onStart, onOpenRun, onManage, onNewAgent, onError }: ComposerAgentsMenuProps): JSX.Element {
  const workspace = useWorkspacePaneActions()
  const agents = useAgentLibrary()
  const runs = useAgentRuns()
  const live = liveTilesByAgent(runs, dockTiles(runs, [], [], Date.now()))
  const ordered = orderAgents(agents, live)
  const runningCount = runs.filter((run) => run.status === 'running').length
  const { busy, error, act } = useAgentRunAction()
  const disabled = !startEnabled || runningTurn || busy
  const triggerRef = useRef<HTMLButtonElement>(null)
  const paneRef = useRef<HTMLElement | null>(null)
  const open = workspace?.agentsMenuPaneId === paneId

  const setOpen = useCallback((next: boolean): void => {
    if (!workspace) return
    workspace.setAgentsMenuPaneId(next ? paneId : workspace.agentsMenuPaneId === paneId ? null : workspace.agentsMenuPaneId)
    if (next) paneRef.current = triggerRef.current?.closest('.chat-pane') ?? null
  }, [paneId, workspace])

  const closeMenu = useCallback((): void => setOpen(false), [setOpen])

  useEffect(() => {
    if (error) onError(error)
  }, [error, onError])

  const openOrStart = (agent: SavedAgent, liveState: DockTileState | undefined, liveChatId: string | undefined): void => {
    closeMenu()
    void act(async () => {
      if (liveChatId && liveState && OPEN_EXISTING.has(liveState)) {
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
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className={cn('composer-pill', runningCount > 0 && 'composer-pill-attention')}
          data-ui="composer.agents"
          data-ui-key={paneId}
          disabled={runningTurn}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Users size={14} strokeWidth={1.9} aria-hidden="true" />
          <span className="composer-pill-label">Agents{runningCount > 0 ? ` · ${runningCount}` : ''}</span>
          <ChevronDown className="composer-pill-chevron" size={11} strokeWidth={2} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="composer-agents-panel"
        container={paneRef.current}
        align="start"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        collisionBoundary={paneRef.current ?? undefined}
        avoidCollisions
      >
        <p className="composer-agents-heading">Saved agents</p>
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
                    onClick={() => openOrStart(agent, liveTile?.state, liveTile?.chatId)}
                  >
                    <span className="composer-agents-item-name">{agent.name}</span>
                    <span className="composer-agents-item-meta">
                      {liveTile && OPEN_EXISTING.has(liveTile.state)
                        ? `Open · ${liveTile.cycleLabel} · ${DOCK_STATE_LABEL[liveTile.state]}`
                        : liveTile
                          ? `Start new run · last ${DOCK_STATE_LABEL[liveTile.state].toLowerCase()}`
                          : 'Start new run'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <div className="composer-agents-foot">
          <button type="button" className="composer-agents-new" data-ui="composer.agents-new" onClick={() => {
            closeMenu()
            queueAgentsViewIntent({ screen: 'build-new' })
            onNewAgent(paneId)
          }}>
            New agent…
          </button>
          <button type="button" className="composer-agents-manage" data-ui="composer.agents-manage" onClick={() => {
            closeMenu()
            onManage(paneId)
          }}>
            Manage
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
