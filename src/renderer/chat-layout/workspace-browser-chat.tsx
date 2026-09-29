import { memo, useEffect, useRef, type Dispatch, type ReactElement } from 'react'
import { ChevronDown, Loader2, MessageSquareText, SquarePen } from 'lucide-react'
import type { ChatWorkspaceAction } from '../chat-state.js'
import { chatRunning } from '../chat-state.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'
import { WorkspaceChat } from './workspace-chat.js'
import { useWorkspacePaneSlice } from './workspace-pane-subscription.js'

/**
 * The browser's quick chat: a strip under the page with one centered button that expands into a
 * full chat pane. It is a real chat (its own thread, tools, and history row), laid out below the
 * page rather than over it, so the live page only gets shorter.
 */
export const WorkspaceBrowserChat = memo(function WorkspaceBrowserChat({ paneId, open, dispatch, appearance, onOpen, onNew, onCollapse }: {
  paneId: string | null
  open: boolean
  dispatch: Dispatch<ChatWorkspaceAction>
  appearance: AppearanceSettings
  onOpen: () => void
  onNew: () => void
  onCollapse: () => void
}): ReactElement {
  const slice = useWorkspacePaneSlice(paneId ?? '')
  const running = paneId !== null && slice.state !== undefined && chatRunning(slice.state)
  const title = slice.chats.find((row) => row.paneId === paneId)?.title ?? 'New chat'
  const bodyRef = useRef<HTMLDivElement>(null)
  // Opening lands in the composer, the way a click on the icon reads.
  useEffect(() => {
    if (open && paneId) bodyRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [open, paneId])
  return (
    <div className={`browser-quick-chat${open ? ' is-open' : ''}`} data-ui-surface="browser-quick-chat">
      {open ? (
        <div className="browser-quick-chat-header">
          <span className="browser-quick-chat-title" title={title}>{title}</span>
          <button type="button" className="browser-nav-button" data-ui="browser.quick-chat-new"
            title="New quick chat" aria-label="New quick chat" onClick={onNew}>
            <SquarePen size={15} aria-hidden="true" />
          </button>
          <button type="button" className="browser-nav-button" data-ui="browser.quick-chat-collapse"
            title="Collapse quick chat" aria-label="Collapse quick chat" onClick={onCollapse}>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="browser-quick-chat-strip">
          <button type="button" className={`browser-quick-chat-toggle${running ? ' is-running' : ''}`} data-ui="browser.quick-chat"
            title={running ? `Quick chat (working): ${title}` : 'Quick chat about this page'} aria-label="Open quick chat"
            aria-expanded={false} onClick={onOpen}>
            {running ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <MessageSquareText size={15} aria-hidden="true" />}
          </button>
        </div>
      )}
      {paneId ? (
        <div ref={bodyRef} className="browser-quick-chat-body" hidden={!open}>
          <WorkspaceChat paneId={paneId} dispatch={dispatch} appearance={appearance} panelVisible={open} onNewChat={onNew} />
        </div>
      ) : null}
    </div>
  )
})
