import { createContext, useContext } from 'react'
import type { AgentRunStartOptions } from '../../shared/agent-runs.js'

/** Per-chat composer shortcuts into workspace-wide browser and agent surfaces. */
export type WorkspacePaneActions = {
  toggleBrowser: () => void
  /** Focus the workspace Agents tab, creating it beside `anchorPaneId` when missing. */
  openAgentsView: (anchorPaneId: string) => void
  startAgentFromPane: (paneId: string, options: AgentRunStartOptions) => Promise<void>
}

export const WorkspacePaneActionsContext = createContext<WorkspacePaneActions | null>(null)

export function useWorkspacePaneActions(): WorkspacePaneActions | null {
  return useContext(WorkspacePaneActionsContext)
}
