import { useImperativeHandle, useRef, useState, type Dispatch, type Ref } from 'react'
import { BrowserPane } from '../browser-pane.js'
import { useBrowserController } from '../browser-controller.js'
import { ChatPane, type ChatPaneDialog } from '../chat-pane.js'
import { usePaneChatController, type useChatController } from '../chat-controller.js'
import { initialChatState, type ChatWorkspaceAction } from '../chat-state.js'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'
import { ChatCanvas } from './chat-canvas.js'
import { useChatLayout } from './layout-controller.js'

export type ChatLayoutHandle = {
  splitChat: (chatId: string, edge: 'right' | 'bottom') => Promise<void>
  toggleBrowser: () => void
}

export function DesktopWorkspace({ chat, appearance, historyOpen, onHistoryOpenChange, dialog, onDialogChange, ref }: {
  chat: ReturnType<typeof useChatController>
  appearance: AppearanceSettings
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
  dialog: ChatPaneDialog | null
  onDialogChange: (dialog: ChatPaneDialog | null) => void
  ref?: Ref<ChatLayoutHandle>
}) {
  const layout = useChatLayout(chat.snapshot)
  useImperativeHandle(ref, () => ({
    splitChat: (chatId, edge) => layout.dock(chatId, chat.selectedPaneId, edge),
    toggleBrowser: layout.toggleBrowser
  }), [layout.dock, layout.toggleBrowser, chat.selectedPaneId])
  const [dragging, setDragging] = useState(false)
  const browser = useBrowserController(JSON.stringify([layout.browserVisible, layout.tree]), layout.browserVisible, dragging)
  const [actionError, setActionError] = useState('')
  const select = (id: string): void => {
    void layout.focusPane(id).catch((reason: unknown) => setActionError(String(reason)))
  }
  return <div className="chat-desktop-workspace">
    {(layout.error || actionError) && <div className="chat-layout-error" role="alert">{layout.error || actionError}</div>}
    <ChatCanvas tree={layout.tree} selectedId={chat.selectedPaneId} busy={layout.busy}
        onDragActive={setDragging}
        browserVisible={layout.browserVisible} onToggleBrowser={layout.toggleBrowser}
        title={(id) => chat.chats.find((row) => row.paneId === id)?.title ?? 'New chat'}
        onSelect={select} onDock={(id, target, edge, singleTab) => { void layout.dock(id, target, edge, singleTab) }}
        onSelectTab={(id) => { onHistoryOpenChange(false); void layout.activateTab(id) }}
        onCloseTab={(id) => { void layout.closeTab(id) }}
        onNewChat={(id) => { onHistoryOpenChange(false); void layout.newChat(id) }}
        onHide={(id) => { void layout.hide(id) }} onResize={layout.resize}
        renderPane={(id) => <WorkspaceChat paneId={id} snapshot={chat.snapshot} dispatch={chat.dispatch}
          appearance={appearance} historyOpen={historyOpen && chat.selectedPaneId === id}
          onHistoryOpenChange={onHistoryOpenChange} dialog={chat.selectedPaneId === id ? dialog : null}
          onDialogChange={onDialogChange} />}
      renderBrowser={<div className="workspace-right" data-mode="browser" data-with-browser={layout.browserVisible ? 'yes' : 'no'}>
        <div className={`workspace-surface workspace-surface-browser${layout.browserVisible ? '' : ' is-collapsed'}`}>
          <BrowserPane controller={browser} />
        </div>
      </div>}
    />
  </div>
}

function WorkspaceChat({ paneId, snapshot, dispatch, appearance, historyOpen, onHistoryOpenChange, dialog, onDialogChange }: {
  paneId: string
  snapshot: ChatWorkspaceSnapshot
  dispatch: Dispatch<ChatWorkspaceAction>
  appearance: AppearanceSettings
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
  dialog: ChatPaneDialog | null
  onDialogChange: (dialog: ChatPaneDialog | null) => void
}) {
  const retained = useRef(initialChatState())
  const state = snapshot.panes?.[paneId] ?? (snapshot.selectedPaneId === paneId ? snapshot.selected : retained.current)
  retained.current = state
  const controller = usePaneChatController(snapshot, paneId, state, dispatch)
  const isSelected = snapshot.selectedPaneId === paneId
  return <ChatPane controller={controller} zoom={appearance.chatZoom} fontSize={appearance.chatFontSize}
    composerFontSize={appearance.composerFontSize} historyOpen={historyOpen} onHistoryOpenChange={onHistoryOpenChange}
    dialog={dialog} onDialogChange={onDialogChange} selected={isSelected} />
}
