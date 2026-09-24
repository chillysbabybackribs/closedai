import type { JSX } from 'react'
import { Globe2 } from 'lucide-react'
import { useWorkspacePaneActions } from './chat-layout/workspace-pane-actions.js'
import { ComposerAgentsMenu } from './composer-agents-menu.js'

export type ComposerAccessPillsProps = {
  paneId: string
  startEnabled: boolean
  runningTurn: boolean
  onComposerError: (message: string) => void
}

/** Browser toggle and agent launcher shown under every chat composer. */
export function ComposerAccessPills({ paneId, startEnabled, runningTurn, onComposerError }: ComposerAccessPillsProps): JSX.Element | null {
  const workspace = useWorkspacePaneActions()
  if (!workspace) return null

  return (
    <div className="composer-pills" aria-label="Workspace shortcuts">
      <button
        type="button"
        className="composer-pill"
        data-ui="composer.browser"
        disabled={runningTurn}
        onClick={() => workspace.toggleBrowser()}
      >
        <Globe2 size={14} strokeWidth={1.9} aria-hidden="true" />
        <span className="composer-pill-label">Browser</span>
      </button>
      <ComposerAgentsMenu
        paneId={paneId}
        startEnabled={startEnabled}
        runningTurn={runningTurn}
        onStart={workspace.startAgentFromPane}
        onOpenRun={(chatId) => workspace.focusChatTab(chatId, paneId)}
        onManage={(id) => workspace.openAgentsView(id)}
        onError={onComposerError}
      />
    </div>
  )
}
