import { memo, useRef, type Dispatch } from 'react'
import type { AgentRunStartOptions } from '../../shared/agent-runs.js'
import { ChatPane } from '../chat-pane.js'
import { usePaneChatController } from '../chat-controller.js'
import { initialChatState, type ChatWorkspaceAction } from '../chat-state.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'
import type { ViewKind } from './layout-views.js'
import { getWorkspaceSnapshot } from './workspace-snapshot-store.js'
import { useWorkspacePaneSlice } from './workspace-pane-subscription.js'

export const WorkspaceChat = memo(function WorkspaceChat({ paneId, dispatch, appearance, onNewChat, onOpenView, onStartAgent, onContinueInNewChat, archiveChat }: {
  paneId: string
  dispatch: Dispatch<ChatWorkspaceAction>
  appearance: AppearanceSettings
  onNewChat: () => void
  /** Open a view tab in this chat's tile (the composer's Agent button). */
  onOpenView?: (kind: ViewKind) => void
  onStartAgent?: (options: AgentRunStartOptions) => Promise<void>
  onContinueInNewChat?: () => Promise<void>
  archiveChat?: (chatId: string) => Promise<void>
}) {
  const slice = useWorkspacePaneSlice(paneId)
  const retained = useRef(initialChatState())
  const retainedPane = useRef(paneId)
  if (retainedPane.current !== paneId) {
    retainedPane.current = paneId
    retained.current = initialChatState()
  }
  const state = slice.state ?? retained.current
  retained.current = state
  const controller = usePaneChatController(getWorkspaceSnapshot(), paneId, state, dispatch)
  const isSelected = slice.selectedPaneId === paneId
  return <ChatPane controller={controller} zoom={appearance.chatZoom} fontSize={appearance.chatFontSize}
    composerFontSize={appearance.composerFontSize} selected={isSelected} onNewChat={onNewChat} onOpenView={onOpenView}
    onStartAgent={onStartAgent} onContinueInNewChat={onContinueInNewChat} archiveChat={archiveChat} />
})
