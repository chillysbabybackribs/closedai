import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Dispatch, type Ref } from 'react'
import { GripVertical } from 'lucide-react'
import { BrowserPane } from '../browser-pane.js'
import { useBrowserController } from '../browser-controller.js'
import { ChatPane, type ChatPaneDialog } from '../chat-pane.js'
import { usePaneChatController, type useChatController } from '../chat-controller.js'
import { initialChatState, type ChatWorkspaceAction } from '../chat-state.js'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'
import { ChatCanvas } from './chat-canvas.js'
import { useChatLayout } from './layout-controller.js'
import { BROWSER_PANE_ID, CHAT_DRAG_TYPE } from './layout-tree.js'
import { tabActivity } from './tab-activity.js'
import type { ChatReviewQueue } from '../chat-history/review-queue.js'

export type ChatLayoutHandle = {
  splitChat: (chatId: string, edge: 'right' | 'bottom') => Promise<void>
  toggleBrowser: () => void
}

export function DesktopWorkspace({ chat, reviewQueue, appearance, historyOpen, onHistoryOpenChange, dialog, onDialogChange, onRenameChat, onRetryChatTitle, onBrowserVisibilityChange, ref }: {
  chat: ReturnType<typeof useChatController>
  reviewQueue: ChatReviewQueue
  appearance: AppearanceSettings
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
  dialog: ChatPaneDialog | null
  onDialogChange: (dialog: ChatPaneDialog | null) => void
  onRenameChat?: (id: string, title: string) => void
  onRetryChatTitle?: (id: string) => void
  onBrowserVisibilityChange: (visible: boolean) => void
  ref?: Ref<ChatLayoutHandle>
}) {
  const layout = useChatLayout(chat.snapshot)
  useEffect(() => onBrowserVisibilityChange(layout.browserVisible), [layout.browserVisible, onBrowserVisibilityChange])
  const browserDragHandle = useMemo(() => <button type="button"
    className="browser-layout-drag" data-ui="layout.browser-drag" draggable={!layout.busy} disabled={layout.busy}
    aria-label="Move browser" title="Drag above or beside a chat; drop at the workspace edge for a full-height column"
    onDragStart={(event) => {
      event.dataTransfer.setData(CHAT_DRAG_TYPE, BROWSER_PANE_ID)
      event.dataTransfer.effectAllowed = 'move'
    }}><GripVertical size={18} aria-hidden="true" /></button>, [layout.busy])
  const [dragging, setDragging] = useState(false)
  const browser = useBrowserController(JSON.stringify([layout.browserVisible, layout.tree]), layout.browserVisible, dragging)
  const imageTabId = browser.browser.image?.tabId
  const [browserRevealVersion, setBrowserRevealVersion] = useState(0)
  useImperativeHandle(ref, () => ({
    splitChat: (chatId, edge) => layout.dock(chatId, chat.selectedPaneId, edge),
    toggleBrowser: () => {
      layout.toggleBrowser()
      setBrowserRevealVersion((value) => value + 1)
    }
  }), [layout.dock, layout.toggleBrowser, chat.selectedPaneId])
  useEffect(() => window.closedai.browser.onState((state) => {
    if (state.image || state.url.startsWith('file:')) {
      layout.showBrowser()
      setBrowserRevealVersion((value) => value + 1)
    }
  }), [layout.showBrowser])
  useEffect(() => {
    if (imageTabId) layout.showBrowser()
  }, [imageTabId, layout.showBrowser])
  const [actionError, setActionError] = useState('')
  const select = (id: string): void => {
    void layout.focusPane(id).catch((reason: unknown) => setActionError(String(reason)))
  }
  return <div className="chat-desktop-workspace">
    {(layout.error || actionError) && <div className="chat-layout-error" role="alert">{layout.error || actionError}</div>}
    <ChatCanvas tree={layout.tree} selectedId={chat.selectedPaneId} busy={layout.busy}
        browserRevealVersion={browserRevealVersion}
        onDragActive={setDragging}
        browserVisible={layout.browserVisible}
        title={(id) => chat.chats.find((row) => row.paneId === id)?.title ?? 'New chat'}
        activity={(id) => tabActivity(chat.chats.find((row) => row.paneId === id),
          chat.snapshot.panes?.[id] ?? (id === chat.selectedPaneId ? chat.snapshot.selected : undefined), reviewQueue[id])}
        onSelect={select} onDock={(id, target, edge, singleTab) => { void layout.dock(id, target, edge, singleTab) }}
        onSelectTab={(id) => { onHistoryOpenChange(false); void layout.activateTab(id) }}
        onCloseTab={(id) => { void layout.closeTab(id) }}
        onNewChat={(id) => { onHistoryOpenChange(false); void layout.newChat(id) }}
        onRenameChat={onRenameChat ? (id) => onRenameChat(id, chat.chats.find((row) => row.paneId === id)?.title ?? 'New chat') : undefined}
        onRetryChatTitle={onRetryChatTitle}
        onHide={(id) => { void layout.hide(id) }} onResize={layout.resize}
        renderPane={(id) => <WorkspaceChat paneId={id} snapshot={chat.snapshot} dispatch={chat.dispatch}
          appearance={appearance} historyOpen={historyOpen && chat.selectedPaneId === id}
          onHistoryOpenChange={onHistoryOpenChange} dialog={chat.selectedPaneId === id ? dialog : null}
          onDialogChange={onDialogChange} onNewChat={() => { void layout.newChat(id) }} />}
      renderBrowser={<div className="workspace-right" data-mode="browser" data-with-browser={layout.browserVisible ? 'yes' : 'no'}>
        <div className={`workspace-surface workspace-surface-browser${layout.browserVisible ? '' : ' is-collapsed'}`}>
          <BrowserPane controller={browser} dragHandle={browserDragHandle} />
        </div>
      </div>}
    />
  </div>
}

function WorkspaceChat({ paneId, snapshot, dispatch, appearance, historyOpen, onHistoryOpenChange, dialog, onDialogChange, onNewChat }: {
  paneId: string
  snapshot: ChatWorkspaceSnapshot
  dispatch: Dispatch<ChatWorkspaceAction>
  appearance: AppearanceSettings
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
  dialog: ChatPaneDialog | null
  onDialogChange: (dialog: ChatPaneDialog | null) => void
  onNewChat: () => void
}) {
  const retained = useRef(initialChatState())
  const state = snapshot.panes?.[paneId] ?? (snapshot.selectedPaneId === paneId ? snapshot.selected : retained.current)
  retained.current = state
  const controller = usePaneChatController(snapshot, paneId, state, dispatch)
  const isSelected = snapshot.selectedPaneId === paneId
  return <ChatPane controller={controller} zoom={appearance.chatZoom} fontSize={appearance.chatFontSize}
    composerFontSize={appearance.composerFontSize} historyOpen={historyOpen} onHistoryOpenChange={onHistoryOpenChange}
    dialog={dialog} onDialogChange={onDialogChange} selected={isSelected} onNewChat={onNewChat} />
}
