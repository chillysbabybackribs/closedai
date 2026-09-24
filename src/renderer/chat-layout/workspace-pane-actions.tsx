import { createContext, useContext } from 'react'
import type { AgentRunStartOptions } from '../../shared/agent-runs.js'

/** Per-chat composer shortcuts into workspace-wide browser and agent surfaces. */
export type WorkspacePaneActions = {
  toggleBrowser: () => void
  /** Add and select a fresh chat tab in the tile that owns `paneId`. */
  newChat: (paneId: string) => void
  /** Focus the workspace Agents tab, creating it beside `anchorPaneId` when missing. */
  openAgentsView: (anchorPaneId: string) => void
  /** Show an open chat tab, adding it to the tile that owns `anchorPaneId` when needed. */
  focusChatTab: (chatId: string, anchorPaneId: string) => Promise<void>
  startAgentFromPane: (paneId: string, options: AgentRunStartOptions) => Promise<void>
  /** Which chat pane's composer Agents menu is open, if any. */
  agentsMenuPaneId: string | null
  setAgentsMenuPaneId: (paneId: string | null) => void
}

export const WorkspacePaneActionsContext = createContext<WorkspacePaneActions | null>(null)

export function useWorkspacePaneActions(): WorkspacePaneActions | null {
  return useContext(WorkspacePaneActionsContext)
}
