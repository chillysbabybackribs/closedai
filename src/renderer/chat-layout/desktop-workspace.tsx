import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Dispatch, type Ref } from 'react'
import { BrowserPane } from '../browser-pane.js'
import { useBrowserController } from '../browser-controller.js'
import { ChatPane, type ChatPaneDialog } from '../chat-pane.js'
import { usePaneChatController, type useChatController } from '../chat-controller.js'
import { initialChatState, type ChatWorkspaceAction } from '../chat-state.js'
import type { ChatWorkspaceSnapshot } from '../../shared/chat-peers.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'
import { ChatCanvas } from './chat-canvas.js'
import { ChatLayoutActions } from './layout-context-menu.js'
import { useChatLayout } from './layout-controller.js'
import { BROWSER_PANE_ID, CHAT_DRAG_TYPE, paneIds } from './layout-tree.js'
import { LayoutPresetsDialog } from './layout-presets-dialog.js'
import type { CanvasSize, LayoutPreset } from './layout-presets.js'
import { tabActivity } from './tab-activity.js'
import type { ChatReviewQueue } from '../chat-history/review-queue.js'

export type ChatLayoutHandle = {
  splitChat: (chatId: string, edge: 'right' | 'bottom') => Promise<void>
  toggleBrowser: () => void
  closeFocused: () => Promise<void>
  openLayoutPresets: () => void
  applyPreset: (preset: LayoutPreset) => void
}

export function DesktopWorkspace({ chat, reviewQueue, appearance, historyOpen, onHistoryOpenChange, dialog, onDialogChange, toolsPreset = null, onRenameChat, onBrowserVisibilityChange, archiveChat, ref }: {
  chat: ReturnType<typeof useChatController>
  reviewQueue: ChatReviewQueue
  appearance: AppearanceSettings
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
  dialog: ChatPaneDialog | null
  onDialogChange: (dialog: ChatPaneDialog | null) => void
  /** Shown in every pane header while the registry is in Read-only; null until known. */
  toolsPreset?: 'full' | 'read-only' | 'custom' | null
  onRenameChat?: (id: string, title: string) => void
  onBrowserVisibilityChange: (visible: boolean) => void
  archiveChat?: (chatId: string) => Promise<void>
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
    }}><span className="browser-layout-drag-dots" aria-hidden="true" /></button>, [layout.busy])
  const [dragging, setDragging] = useState(false)
  const browser = useBrowserController(JSON.stringify([layout.browserVisible, layout.tree]), layout.browserVisible, dragging)
  const imageTabId = browser.browser.image?.tabId
  const [browserRevealVersion, setBrowserRevealVersion] = useState(0)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const canvasSize = useRef<CanvasSize>({ width: 0, height: 0 })
  useImperativeHandle(ref, () => ({
    splitChat: (chatId, edge) => layout.dock(chatId, chat.selectedPaneId, edge),
    toggleBrowser: () => {
      layout.toggleBrowser()
      setBrowserRevealVersion((value) => value + 1)
    },
    closeFocused: () => layout.closeFocused(),
    openLayoutPresets: () => setPresetsOpen(true),
    applyPreset: (preset) => {
      setBrowserRevealVersion((value) => value + 1)
      void layout.arrange(preset, canvasSize.current)
    }
  }), [layout.dock, layout.toggleBrowser, layout.closeFocused, layout.arrange, chat.selectedPaneId])
  useEffect(() => window.closedai.browser.onState((state) => {
    if (state.image || state.url.startsWith('file:')) {
      layout.showBrowser()
      setBrowserRevealVersion((value) => value + 1)
    }
  }), [layout.showBrowser])
  useEffect(() => {
    if (imageTabId) layout.showBrowser()
  }, [imageTabId, layout.showBrowser])
  const select = (id: string): void => { void layout.focusPane(id) }
  // One path for both entry points: the tab header's continue action and the message action under
  // the latest completed response.
  const continueChat = (id: string): Promise<void> => {
    onHistoryOpenChange(false)
    const row = chat.chats.find((entry) => entry.paneId === id)
    return layout.continueChat(id, row?.threadId ?? null, row?.modelId ?? null)
  }
  const actions = useMemo(() => ({ moveTab: layout.moveTabToTile }), [layout.moveTabToTile])
  return <div className="chat-desktop-workspace">
    {layout.error && <div className="chat-layout-error" role="alert">{layout.error}</div>}
    <ChatLayoutActions.Provider value={actions}>
    <ChatCanvas tree={layout.tree} selectedId={chat.selectedPaneId} busy={layout.busy}
        notice={layout.notice} toolsPreset={toolsPreset}
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
        chatRow={(id) => chat.chats.find((row) => row.paneId === id)}
        onTogglePin={(id, pinned) => { void chat.sidebar.setChatPinned(id, pinned).catch(() => {}) }}
        onContinueChat={(id) => { void continueChat(id) }}
        onPauseTab={(id) => { void chat.interruptPane(id) }}
        onResumeTab={(id) => { void chat.resumePane(id) }}
        onOpenPresets={() => setPresetsOpen(true)}
        onSizeChange={(size) => { canvasSize.current = size }}
        onHide={(id) => { void layout.hide(id) }} onResize={layout.resize}
        renderPane={(id) => <WorkspaceChat paneId={id} snapshot={chat.snapshot} dispatch={chat.dispatch}
          appearance={appearance} historyOpen={historyOpen && chat.selectedPaneId === id}
          onHistoryOpenChange={onHistoryOpenChange} dialog={chat.selectedPaneId === id ? dialog : null}
          onDialogChange={onDialogChange} archiveChat={archiveChat}
          onContinueInNewChat={() => continueChat(id)}
          onNewChat={() => { void layout.newChat(id) }} />}
      renderBrowser={<div className="workspace-right" data-mode="browser" data-with-browser={layout.browserVisible ? 'yes' : 'no'}>
        <div className={`workspace-surface workspace-surface-browser${layout.browserVisible ? '' : ' is-collapsed'}`}>
          <BrowserPane controller={browser} dragHandle={browserDragHandle} />
        </div>
      </div>}
    />
    </ChatLayoutActions.Provider>
    <LayoutPresetsDialog open={presetsOpen} size={canvasSize.current} tileCount={paneIds(layout.tree).length}
      onClose={() => setPresetsOpen(false)}
      onApply={(preset) => {
        setBrowserRevealVersion((value) => value + 1)
        void layout.arrange(preset, canvasSize.current)
      }} />
  </div>
}

function WorkspaceChat({ paneId, snapshot, dispatch, appearance, historyOpen, onHistoryOpenChange, dialog, onDialogChange, onNewChat, onContinueInNewChat, archiveChat }: {
  paneId: string
  snapshot: ChatWorkspaceSnapshot
  dispatch: Dispatch<ChatWorkspaceAction>
  appearance: AppearanceSettings
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
  dialog: ChatPaneDialog | null
  onDialogChange: (dialog: ChatPaneDialog | null) => void
  onNewChat: () => void
  /** Digest-seeded continuation for the message action under the latest completed response. */
  onContinueInNewChat?: () => Promise<void>
  archiveChat?: (chatId: string) => Promise<void>
}) {
  const retained = useRef(initialChatState())
  const state = snapshot.panes?.[paneId] ?? (snapshot.selectedPaneId === paneId ? snapshot.selected : retained.current)
  retained.current = state
  const controller = usePaneChatController(snapshot, paneId, state, dispatch)
  const isSelected = snapshot.selectedPaneId === paneId
  return <ChatPane controller={controller} zoom={appearance.chatZoom} fontSize={appearance.chatFontSize}
    composerFontSize={appearance.composerFontSize} historyOpen={historyOpen} onHistoryOpenChange={onHistoryOpenChange}
    dialog={dialog} onDialogChange={onDialogChange} selected={isSelected} onNewChat={onNewChat}
    onContinueInNewChat={onContinueInNewChat} archiveChat={archiveChat} />
}
