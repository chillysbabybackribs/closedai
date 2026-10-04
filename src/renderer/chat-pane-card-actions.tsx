import type { JSX } from 'react'
import { MessageSquareShare, Plus, RotateCcw } from './icons/index.js'
import { useWorkspacePaneActions } from './chat-layout/workspace-pane-actions.js'

/** New chat window, fresh-context continuation and clear, centred under the composer of a desk chat card. */
export function ChatPaneCardActions({ paneId, hasThread, running }: {
  paneId: string
  hasThread: boolean
  running: boolean
}): JSX.Element | null {
  const workspace = useWorkspacePaneActions()
  if (!workspace) return null
  const idle = hasThread && !running
  return (
    <div className="chat-pane-card-actions">
      <button type="button" className="chat-pane-card-action" data-ui="chat.new-window" data-ui-key={paneId}
        title="New chat window" aria-label="New chat window"
        onClick={() => workspace.newChatWindow()}>
        <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <button type="button" className="chat-pane-card-action" data-ui="chat.continue-fresh" data-ui-key={paneId}
        disabled={!idle} title="Continue in new chat with fresh context"
        aria-label="Continue in new chat with fresh context"
        onClick={() => { void workspace.continueChat(paneId).catch(() => {}) }}>
        <MessageSquareShare size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <button type="button" className="chat-pane-card-action" data-ui="chat.clear" data-ui-key={paneId}
        disabled={!idle} title="Clear chat (the conversation stays in history)"
        aria-label="Clear chat"
        onClick={() => { void workspace.clearChat(paneId).catch(() => {}) }}>
        <RotateCcw size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  )
}
