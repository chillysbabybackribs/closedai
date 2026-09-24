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

/** The Agents view: opened from the tile + menu or Agent → Agents…. */
export function AgentLibraryView({ active, startEnabled, onStart, chats, onOpenChat }: AgentLibraryViewProps): JSX.Element {
  const agents = useAgentLibrary()
  const now = useMemo(() => Date.now(), [active]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (draft: SavedAgentDraft, id: string | null): Promise<SavedAgent> => {
    // An entry deleted elsewhere while it sat in the editor is saved again as a new one.
    const updated = id ? await window.closedai.agentLibrary.update(id, draft) : null
    return updated ?? window.closedai.agentLibrary.save(draft)
  }
  return (
      <div className="agent-library-view">
        <header className="shrink-0 border-b px-6 py-3.5">
          <h2 className="text-sm font-semibold">Agents</h2>
          <p className="text-muted-foreground text-xs">
            Standing instructions the app keeps driving cycle after cycle. Start opens a new chat beside the chat this view follows, with its model and folder.
          </p>
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
