import { memo, useRef, type Dispatch } from 'react'
import { ChatPane, type ChatPaneDialog } from '../chat-pane.js'
import { usePaneChatController } from '../chat-controller.js'
import { initialChatState, type ChatWorkspaceAction } from '../chat-state.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'
import { getWorkspaceSnapshot } from './workspace-snapshot-store.js'
import { useWorkspacePaneSlice } from './workspace-pane-subscription.js'

export const WorkspaceChat = memo(function WorkspaceChat({ paneId, dispatch, appearance, historyOpen, onHistoryOpenChange, dialog, onDialogChange, onNewChat, onContinueInNewChat, archiveChat, openHistoryChat }: {
  paneId: string
  dispatch: Dispatch<ChatWorkspaceAction>
  appearance: AppearanceSettings
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
  dialog: ChatPaneDialog | null
  onDialogChange: (dialog: ChatPaneDialog | null) => void
  onNewChat: () => void
  onContinueInNewChat?: () => Promise<void>
  archiveChat?: (chatId: string) => Promise<void>
  openHistoryChat?: (chatId: string) => Promise<void>
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
    composerFontSize={appearance.composerFontSize} historyOpen={historyOpen} onHistoryOpenChange={onHistoryOpenChange}
    dialog={dialog} onDialogChange={onDialogChange} selected={isSelected} onNewChat={onNewChat}
    onContinueInNewChat={onContinueInNewChat} archiveChat={archiveChat}
    openHistoryChat={openHistoryChat} />
})
