import type { JSX } from 'react'
import { useWorkspacePaneActions } from './chat-layout/workspace-pane-actions.js'
import { ComposerAgentsMenu } from './composer-agents-menu.js'
import { ComposerContinuePill } from './composer-continue-pill.js'

export type ComposerWorkspaceToolsProps = {
  paneId: string
  startEnabled: boolean
  runningTurn: boolean
  continueMessageId?: string | null
  /** Context window fill, 0–100; the handoff names itself once a fresh window is worth it. */
  contextPercent?: number | null
  onContinueInNewChat?: () => Promise<void>
  onComposerError: (message: string) => void
}

/** From this share of the window on, Fresh context carries its label instead of only an icon. */
export const FRESH_CONTEXT_LABEL_PERCENT = 50

/**
 * The capsule's workspace controls beside the paperclip: the saved-agent launcher, and the
 * fresh-context handoff while the latest reply can hand off. New chat and Browser are not here:
 * the tile header and the dock already own them.
 */
export function ComposerWorkspaceTools({
  paneId, startEnabled, runningTurn, continueMessageId, contextPercent, onContinueInNewChat, onComposerError
}: ComposerWorkspaceToolsProps): JSX.Element | null {
  const workspace = useWorkspacePaneActions()
  if (!workspace) return null

  return (
    <>
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
      {continueMessageId && onContinueInNewChat ? (
        <ComposerContinuePill
          messageId={continueMessageId}
          runningTurn={runningTurn}
          labelled={(contextPercent ?? 0) >= FRESH_CONTEXT_LABEL_PERCENT}
          onContinue={onContinueInNewChat}
          onError={onComposerError}
        />
      ) : null}
    </>
  )
}
