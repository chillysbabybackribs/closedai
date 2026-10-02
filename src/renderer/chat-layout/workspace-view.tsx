import { lazy, memo, Suspense, type ReactNode } from 'react'
import { Check, ChevronDown, Pin } from 'lucide-react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger
} from '../../components/ui/dropdown-menu.js'
import { VIEW_LABELS, type ViewKind, type ViewScope } from './layout-views.js'

const TracePanel = lazy(async () => {
  const module = await import('../trace/trace-panel.js')
  return { default: module.TracePanel }
})
const ToolsPanel = lazy(async () => {
  const module = await import('../tools/tools-panel.js')
  return { default: module.ToolsPanel }
})
const ChatHistory = lazy(async () => {
  const module = await import('../chat-history.js')
  return { default: module.ChatHistory }
})
const SavedSitesPanel = lazy(async () => {
  const module = await import('../saved-sites/saved-sites-panel.js')
  return { default: module.SavedSitesPanel }
})

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
  savedSites: {
    update: (id: string, note: string) => Promise<void>
    remove: (id: string) => Promise<void>
    openSite: (url: string) => Promise<void>
  }
  onSavedSitesError: (reason: unknown) => void
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
 * pinned means it does not. Saved sites shows no toolbar: it is workspace-wide.
 */
export const WorkspaceView = memo(function WorkspaceView({ viewId, kind, active, scope, pinOptions, onPin, onClose, onSendToChat, history, savedSites, onSavedSitesError }: WorkspaceViewProps): ReactNode {
  const chatTitle = pinOptions.find((option) => option.id === scope.chatId)?.title ?? 'this chat'
  const scoped = kind !== 'saved-sites'
  return <section className="workspace-view" data-ui={`view.${kind}`} data-ui-key={viewId} data-kind={kind}
    aria-label={`${VIEW_LABELS[kind]} view`}>
    {scoped && <div className="workspace-view-bar">
      <ScopeChip viewId={viewId} scope={scope} chatTitle={chatTitle} pinOptions={pinOptions} onPin={onPin} />
    </div>}
    <div className="workspace-view-body">
      <Suspense fallback={null}>
        {kind === 'trace' && <TracePanel paneId={scope.chatId} active={active} />}
        {kind === 'tools' && <ToolsPanel active={active} onSendToChat={(text) => onSendToChat(scope.chatId, text)} />}
        {kind === 'history' && <ChatHistory activeChatId={scope.chatId} busy={history.busy} listChats={history.listChats}
          chats={history.chats} openChat={history.openChat} archiveChat={history.archiveChat} onClose={onClose} onOpened={() => {}} />}
        {kind === 'saved-sites' && <SavedSitesPanel active={active} onError={onSavedSitesError} onOpenSite={savedSites.openSite}
          update={savedSites.update} remove={savedSites.remove} />}
      </Suspense>
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
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <button type="button" className="workspace-view-scope" data-ui="view.scope" data-ui-key={viewId} data-mode={scope.mode}
        title={pinned ? 'Pinned to one chat; open to follow this pane instead' : 'Following the chat in this pane; open to pin one chat'}
        aria-label={`${pinned ? 'Pinned to' : 'Following'} ${chatTitle}. Change scope`}>
        {pinned && <Pin size={12} aria-hidden="true" />}
        <span className="workspace-view-scope-mode">{pinned ? 'Pinned' : 'Following'}</span>
        <span className="workspace-view-scope-sep" aria-hidden="true">·</span>
        <span className="workspace-view-scope-chat">{chatTitle}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="min-w-[220px]" align="start" loop>
      <DropdownMenuItem data-ui="view.scope-follow" data-ui-key={viewId} disabled={!pinned} onSelect={() => onPin(null)}>
        <span className="workspace-view-scope-check">{!pinned && <Check aria-hidden="true" />}</span>
        <span>Follow this pane</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Pin to a chat</DropdownMenuLabel>
      {pinOptions.map((option) => <DropdownMenuItem key={option.id} data-ui="view.scope-pin" data-ui-key={option.id}
        onSelect={() => onPin(option.id)}>
        <span className="workspace-view-scope-check">{pinned && option.id === scope.chatId && <Check aria-hidden="true" />}</span>
        <span className="workspace-view-scope-option">{option.title}</span>
      </DropdownMenuItem>)}
      {!pinOptions.length && <DropdownMenuItem disabled>
        <span className="workspace-view-scope-check" /><span>No open chats</span>
      </DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>
}

