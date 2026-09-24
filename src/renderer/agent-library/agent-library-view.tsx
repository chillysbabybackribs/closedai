import type { JSX } from 'react'
import { useMemo } from 'react'

import type { SavedAgent, SavedAgentDraft } from '../../shared/agent-library.js'
import type { AgentRunStartOptions } from '../../shared/agent-runs.js'
import { AgentLibraryPanel } from './agent-library-panel.js'
import { useAgentLibrary } from './agent-library-store.js'
import { AgentRunOverview } from '../agent-runs/agent-run-overview.js'
import type { DockChatActivity } from '../agent-runs/agent-run-overview-model.js'

export type AgentLibraryViewProps = {
  /** The view tab is in front; relative times refresh when it returns. */
  active: boolean
  startEnabled: boolean
  /** Docks a new chat beside the scoped chat's tile and starts the run on it. */
  onStart: (options: AgentRunStartOptions) => Promise<void>
  chats: readonly DockChatActivity[]
  onOpenChat: (chatId: string) => void
}

const START_STEPS = [
  'Write what the agent should do on each cycle in Instructions.',
  'Optionally name it and Save to keep it in your library.',
  'Press Start — a new chat opens beside this pane and runs until you pause or stop it.'
] as const

/** The Agents view: opened from the tile + menu or Agent → Agents…. */
export function AgentLibraryView({ active, startEnabled, onStart, chats, onOpenChat }: AgentLibraryViewProps): JSX.Element {
  const agents = useAgentLibrary()
  const now = useMemo(() => Date.now(), [active]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (draft: SavedAgentDraft, id: string | null): Promise<SavedAgent> => {
    const updated = id ? await window.closedai.agentLibrary.update(id, draft) : null
    return updated ?? window.closedai.agentLibrary.save(draft)
  }
  return (
    <div className="agent-library-view">
      <header className="agent-library-intro">
        <div>
          <h2 className="agent-library-title">Agents</h2>
          <p className="agent-library-lede">
            Reusable instructions the app sends every cycle. Runs stay visible above; each one is a normal chat you can open anytime.
          </p>
        </div>
        <ol className="agent-library-steps">
          {START_STEPS.map((step, index) => (
            <li key={step}><span className="agent-library-step-num">{index + 1}</span>{step}</li>
          ))}
        </ol>
      </header>
      <AgentRunOverview chats={chats} onOpenChat={onOpenChat} />
      <AgentLibraryPanel
        agents={agents}
        now={now}
        startEnabled={startEnabled}
        onSave={save}
        onRemove={(id) => window.closedai.agentLibrary.remove(id)}
        onStart={onStart}
      />
    </div>
  )
}
