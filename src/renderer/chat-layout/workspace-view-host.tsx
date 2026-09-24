import { createContext, useContext, type ReactNode } from 'react'
import type { AgentRunStartOptions } from '../../shared/agent-runs.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { ChatLayout, ViewScopes } from './layout-tree.js'
import { chatTabIds, tabOwner } from './layout-tabs.js'
import { viewScope, type ViewKind } from './layout-views.js'
import { WorkspaceView } from './workspace-view.js'

/**
 * Live workspace facts a view reads directly. The canvas memoises its render props, so a view
 * subscribes here instead of receiving titles, rows and scope through the tile render call.
 */
export type WorkspaceViewContextValue = {
  tree: ChatLayout
  views: ViewScopes | undefined
  selectedPaneId: string
  chats: ChatRowSummary[]
  title: (id: string) => string
  listChats: () => Promise<ChatRowSummary[]>
  archiveChat: (chatId: string) => Promise<void>
  /** Show a chat tab, adding it to `anchor`'s tile when it is not open. */
  activateChat: (chatId: string, anchor?: string) => Promise<void>
  pinView: (viewId: string, chatId: string | null) => void
  closeTab: (id: string) => void
  /** Put text in a chat's composer and bring that chat forward. */
  sendToChat: (chatId: string, text: string) => void
  /** Start a run in a new chat beside `chatId`'s tile; undefined when runs cannot start. */
  startAgent?: (chatId: string, options: AgentRunStartOptions) => Promise<void>
}

export const WorkspaceViewContext = createContext<WorkspaceViewContextValue | null>(null)

export function WorkspaceViewHost({ viewId, kind }: { viewId: string; kind: ViewKind }): ReactNode {
  const workspace = useContext(WorkspaceViewContext)
  if (!workspace) return null
  const { tree, views, selectedPaneId, chats, title } = workspace
  const scope = viewScope(tree, viewId, views, selectedPaneId)
  const tile = tabOwner(tree, viewId)
  const row = chats.find((entry) => entry.paneId === scope.chatId)
  const pinOptions = chatTabIds(tree).map((id) => ({ id, title: title(id) }))
  return <WorkspaceView viewId={viewId} kind={kind} active={tile === viewId} scope={scope} pinOptions={pinOptions}
    onPin={(chatId) => workspace.pinView(viewId, chatId)} onClose={() => workspace.closeTab(viewId)}
    onSendToChat={workspace.sendToChat} onStartAgent={workspace.startAgent} startEnabled={Boolean(row)}
    history={{ listChats: workspace.listChats, chats, busy: row?.running ?? false,
      openChat: (chatId) => workspace.activateChat(chatId, tile ?? undefined), archiveChat: workspace.archiveChat }} />
}
