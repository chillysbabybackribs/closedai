import type { JSX } from 'react'
import { Globe2, Plus } from 'lucide-react'
import { useWorkspacePaneActions } from './chat-layout/workspace-pane-actions.js'
import { ComposerAgentsMenu } from './composer-agents-menu.js'
import { ComposerContinuePill } from './composer-continue-pill.js'

export type ComposerAccessPillsProps = {
  paneId: string
  startEnabled: boolean
  runningTurn: boolean
  continueMessageId?: string | null
  onContinueInNewChat?: () => Promise<void>
  onComposerError: (message: string) => void
}

/** Browser toggle and agent launcher shown under every chat composer. */
export function ComposerAccessPills({ paneId, startEnabled, runningTurn, continueMessageId, onContinueInNewChat, onComposerError }: ComposerAccessPillsProps): JSX.Element | null {
  const workspace = useWorkspacePaneActions()
  if (!workspace) return null

  return (
    <div className="composer-pills" aria-label="Workspace shortcuts">
      <button
        type="button"
        className="composer-pill"
        data-ui="composer.new-chat"
        data-ui-key={paneId}
        onClick={() => workspace.newChat(paneId)}
      >
        <Plus size={14} strokeWidth={1.9} aria-hidden="true" />
        <span className="composer-pill-label">New chat</span>
      </button>
      <ComposerAgentsMenu
        paneId={paneId}
        startEnabled={startEnabled}
        runningTurn={runningTurn}
        onStart={workspace.startAgentFromPane}
        onOpenRun={(chatId) => workspace.focusChatTab(chatId, paneId)}
        onManage={(id) => workspace.openAgentsView(id)}
        onNewAgent={(id) => workspace.openAgentsView(id)}
        onError={onComposerError}
      />
      <button
        type="button"
        className="composer-pill"
        data-ui="composer.browser"
        onClick={() => workspace.toggleBrowser()}
      >
        <Globe2 size={14} strokeWidth={1.9} aria-hidden="true" />
        <span className="composer-pill-label">Browser</span>
      </button>
      {continueMessageId && onContinueInNewChat ? (
        <ComposerContinuePill
          messageId={continueMessageId}
          runningTurn={runningTurn}
          onContinue={onContinueInNewChat}
          onError={onComposerError}
        />
      ) : null}
    </div>
  )
}
