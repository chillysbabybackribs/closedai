import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { SavedAgent, SavedAgentDraft } from '../../shared/agent-library.js'
import type { AgentRunStartOptions } from '../../shared/agent-runs.js'
import type { CredentialApprovalRequest } from '../../shared/security.js'
import { securityRequests } from '../security-requests.js'
import { AgentRunOverview } from '../agent-runs/agent-run-overview.js'
import { dockSummary, dockTiles, type DockChatActivity } from '../agent-runs/agent-run-overview-model.js'
import { useAgentRuns } from '../agent-runs/agent-runs-store.js'
import { AgentLibraryCards, liveTilesByAgent } from './agent-library-cards.js'
import { AgentLibraryPanel, type AgentDraft } from './agent-library-panel.js'
import { useAgentLibrary } from './agent-library-store.js'
import { AgentScreenHeader } from './agent-screen-header.js'

// The Agents view: three stacked screens. The Library (saved-agent cards) is the root; Build
// (one agent's editor) and Runs (every run) are pushed screens with a back control. A draft the
// user backs out of is held for the session so a mis-click does not lose the instructions.

export type AgentLibraryViewProps = {
  /** The view tab is in front; relative times refresh when it returns. */
  active: boolean
  startEnabled: boolean
  /** Docks a new chat beside this tab's tile and starts the run on it. */
  onStart: (options: AgentRunStartOptions) => Promise<void>
  chats: readonly DockChatActivity[]
  onOpenChat: (chatId: string) => void
}

type Screen = { kind: 'library' } | { kind: 'runs' } | { kind: 'build'; agentId: string | null }

/** Durations on the Runs screen tick while a run is live; elsewhere the clock only moves on a screen change. */
const RUNS_CLOCK_MS = 10_000

function useRunsClock(ticking: boolean, resetOn: unknown[]): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), RUNS_CLOCK_MS)
    return () => clearInterval(timer)
  }, [ticking, ...resetOn]) // eslint-disable-line react-hooks/exhaustive-deps
  return now
}

const LIBRARY: Screen = { kind: 'library' }
const NEW_DRAFT = 'new'

/** The Agents view: opened from the title-bar icon, the tile + menu, or Agent → Agents…. */
export function AgentLibraryView({ active, startEnabled, onStart, chats, onOpenChat }: AgentLibraryViewProps): JSX.Element {
  const agents = useAgentLibrary()
  const runs = useAgentRuns()
  const [approvals, setApprovals] = useState<CredentialApprovalRequest[]>([])
  useEffect(() => securityRequests().credentials.subscribe(setApprovals), [])
  const [screen, setScreen] = useState<Screen>(LIBRARY)
  const held = useRef(new Map<string, AgentDraft>())
  const now = useRunsClock(active && screen.kind === 'runs' && runs.some((run) => run.status === 'running'), [active, screen])
  const tiles = useMemo(() => dockTiles(runs, chats, approvals, now), [runs, chats, approvals, now])
  const live = useMemo(() => liveTilesByAgent(runs, tiles), [runs, tiles])
  const save = async (draft: SavedAgentDraft, id: string | null): Promise<SavedAgent> => {
    // An entry deleted elsewhere while it sat in the editor is saved again as a new one.
    const updated = id ? await window.closedai.agentLibrary.update(id, draft) : null
    return updated ?? window.closedai.agentLibrary.save(draft)
  }
  const build = (agentId: string | null): void => setScreen({ kind: 'build', agentId })

  let body: JSX.Element
  if (screen.kind === 'build') {
    const key = screen.agentId ?? NEW_DRAFT
    body = <AgentLibraryPanel key={key} agents={agents} initialAgentId={screen.agentId} initialDraft={held.current.get(key)}
      startEnabled={startEnabled} onSave={save} onRemove={(id) => window.closedai.agentLibrary.remove(id)} onStart={onStart}
      onBack={(draft, agentId) => {
        held.current.delete(key)
        if (draft) held.current.set(agentId ?? NEW_DRAFT, draft)
        setScreen(LIBRARY)
      }}
      onDone={() => { held.current.delete(key); setScreen(LIBRARY) }} />
  } else if (screen.kind === 'runs') {
    const api = window.closedai.agentRuns
    body = <div className="agent-screen">
      <AgentScreenHeader title="Runs" onBack={() => setScreen(LIBRARY)}>
        <span className="agent-screen-summary" role="status">{dockSummary(tiles)}</span>
      </AgentScreenHeader>
      <AgentRunOverview tiles={tiles} onOpenChat={onOpenChat} onNewAgent={() => build(null)}
        onPause={(id) => api.pause(id)} onResume={(id) => api.resume(id)} onStop={(id) => api.stop(id)} />
    </div>
  } else {
    body = <AgentLibraryCards agents={agents} tiles={tiles} live={live} now={now} startEnabled={startEnabled}
      onNew={() => build(null)} onEdit={(agent) => build(agent.id)} onRuns={() => setScreen({ kind: 'runs' })} onStart={onStart} />
  }
  return <div className="agent-library-view" data-screen={screen.kind}>{body}</div>
}
