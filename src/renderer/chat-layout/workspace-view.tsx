import { memo, type ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'
import { Check, ChevronDown, Pin } from 'lucide-react'
import type { AgentRunStartOptions } from '../../shared/agent-runs.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { AgentLibraryView } from '../agent-library/agent-library-view.js'
import { ChatHistory } from '../chat-history.js'
import { ToolsPanel } from '../tools/tools-panel.js'
import { TracePanel } from '../trace/trace-panel.js'
import { VIEW_LABELS, type ViewKind, type ViewScope } from './layout-views.js'
import { VIEW_ICONS } from './pane-add-menu.js'

export type WorkspaceViewProps = {
  viewId: string
  kind: ViewKind
  /** The tab is in front; hidden views stop polling. */
  active: boolean
  scope: ViewScope
  /** Open chat tabs the view can be pinned to, in strip order. */
  pinOptions: Array<{ id: string; title: string }>
  onPin: (chatId: string | null) => void
  onClose: () => void
  /** Tools repair drafts go to the scoped chat's composer. */
  onSendToChat: (chatId: string, text: string) => void
  /** Agents start beside the scoped chat's tile; undefined when the app cannot start runs. */
  onStartAgent?: (chatId: string, options: AgentRunStartOptions) => Promise<void>
  startEnabled: boolean
  history: {
    listChats: () => Promise<ChatRowSummary[]>
    chats: ChatRowSummary[]
    busy: boolean
    openChat: (chatId: string) => Promise<void>
    archiveChat: (chatId: string) => Promise<void>
  }
}

/**
 * A view tab's body: a quiet toolbar whose only control is the scope chip, then the panel that
 * used to live in a dialog. Following a tile means the panel retargets as the tile's chat changes;
 * pinned means it does not.
 */
export const WorkspaceView = memo(function WorkspaceView({ viewId, kind, active, scope, pinOptions, onPin, onClose, onSendToChat, onStartAgent, startEnabled, history }: WorkspaceViewProps): ReactNode {
  const chatTitle = pinOptions.find((option) => option.id === scope.chatId)?.title ?? 'this chat'
  return <section className="workspace-view" data-ui={`view.${kind}`} data-ui-key={viewId} data-kind={kind}
    aria-label={`${VIEW_LABELS[kind]} view`}>
    <div className="workspace-view-bar">
      <ScopeChip viewId={viewId} scope={scope} chatTitle={chatTitle} pinOptions={pinOptions} onPin={onPin} />
    </div>
    <div className="workspace-view-body">
      {kind === 'trace' && <TracePanel paneId={scope.chatId} active={active} />}
      {kind === 'tools' && <ToolsPanel active={active} onSendToChat={(text) => onSendToChat(scope.chatId, text)} />}
      {kind === 'agents' && onStartAgent && <AgentLibraryView active={active} startEnabled={startEnabled}
        onStart={(options) => onStartAgent(scope.chatId, options)} />}
      {kind === 'history' && <ChatHistory activeChatId={scope.chatId} busy={history.busy} listChats={history.listChats}
        chats={history.chats} openChat={history.openChat} archiveChat={history.archiveChat} onClose={onClose} onOpened={() => {}} />}
    </div>
  </section>
})

function ScopeChip({ viewId, scope, chatTitle, pinOptions, onPin }: {
  viewId: string
  scope: ViewScope
  chatTitle: string
  pinOptions: Array<{ id: string; title: string }>
  onPin: (chatId: string | null) => void
}): ReactNode {
  const pinned = scope.mode === 'pinned'
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild>
      <button type="button" className="workspace-view-scope" data-ui="view.scope" data-ui-key={viewId} data-mode={scope.mode}
        title={pinned ? 'Pinned to one chat; open to follow this pane instead' : 'Following the chat in this pane; open to pin one chat'}
        aria-label={`${pinned ? 'Pinned to' : 'Following'} ${chatTitle}. Change scope`}>
        {pinned && <Pin size={12} aria-hidden="true" />}
        <span className="workspace-view-scope-mode">{pinned ? 'Pinned' : 'Following'}</span>
        <span className="workspace-view-scope-sep" aria-hidden="true">·</span>
        <span className="workspace-view-scope-chat">{chatTitle}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="titlebar-menu-content chat-layout-context-menu" align="start" sideOffset={4} loop>
        <DropdownMenu.Item className="titlebar-menu-item chat-layout-add-menu-item" data-ui="view.scope-follow" data-ui-key={viewId}
          disabled={!pinned} onSelect={() => onPin(null)}>
          <div className="chat-layout-menu-item-left">
            <span className="workspace-view-scope-check">{!pinned && <Check size={14} aria-hidden="true" />}</span>
            <span>Follow this pane</span>
          </div>
        </DropdownMenu.Item>
        <DropdownMenu.Separator className="titlebar-menu-separator" />
        <DropdownMenu.Label className="titlebar-menu-heading chat-layout-add-menu-heading">Pin to a chat</DropdownMenu.Label>
        {pinOptions.map((option) => <DropdownMenu.Item key={option.id} className="titlebar-menu-item chat-layout-add-menu-item"
          data-ui="view.scope-pin" data-ui-key={option.id} onSelect={() => onPin(option.id)}>
          <div className="chat-layout-menu-item-left">
            <span className="workspace-view-scope-check">{pinned && option.id === scope.chatId && <Check size={14} aria-hidden="true" />}</span>
            <span className="workspace-view-scope-option">{option.title}</span>
          </div>
        </DropdownMenu.Item>)}
        {!pinOptions.length && <DropdownMenu.Item className="titlebar-menu-item chat-layout-add-menu-item" disabled>
          <div className="chat-layout-menu-item-left"><span className="workspace-view-scope-check" /><span>No open chats</span></div>
        </DropdownMenu.Item>}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}

export { VIEW_ICONS }
