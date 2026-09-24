import { memo, useRef, type Dispatch } from 'react'
import { ChatPane } from '../chat-pane.js'
import { usePaneChatController } from '../chat-controller.js'
import { initialChatState, type ChatWorkspaceAction } from '../chat-state.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'
import { getWorkspaceSnapshot } from './workspace-snapshot-store.js'
import { useWorkspacePaneSlice } from './workspace-pane-subscription.js'

export const WorkspaceChat = memo(function WorkspaceChat({ paneId, dispatch, appearance, panelVisible = true, onNewChat, onContinueInNewChat }: {
  paneId: string
  dispatch: Dispatch<ChatWorkspaceAction>
  appearance: AppearanceSettings
  panelVisible?: boolean
  onNewChat: () => void
  onContinueInNewChat?: () => Promise<void>
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
    composerFontSize={appearance.composerFontSize} selected={isSelected} panelVisible={panelVisible}
    onNewChat={onNewChat} onContinueInNewChat={onContinueInNewChat} />
})
