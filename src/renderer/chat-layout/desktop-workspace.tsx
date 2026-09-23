import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactElement, type Ref } from 'react'
import { BrowserPane } from '../browser-pane.js'
import { useBrowserController } from '../browser-controller.js'
import { type ChatPaneDialog } from '../chat-pane.js'
import { type useChatController } from '../chat-controller.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'
import { ChatCanvas } from './chat-canvas.js'
import { ChatLayoutActions } from './layout-context-menu.js'
import { useChatLayout } from './layout-controller.js'
import { BROWSER_PANE_ID, CHAT_DRAG_TYPE, paneIds } from './layout-tree.js'
import { LayoutPresetsDialog } from './layout-presets-dialog.js'
import type { CanvasSize, LayoutPreset } from './layout-presets.js'
import type { ChatReviewQueue } from '../chat-history/review-queue.js'
import { WorkspaceChat } from './workspace-chat.js'

export type ChatLayoutHandle = {
  splitChat: (chatId: string, edge: 'right' | 'bottom') => Promise<void>
  /** Open or focus a saved chat and sync the tab strip before the transcript paints. */
  activateChat: (chatId: string) => Promise<void>
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
  const chatsRef = useRef(chat.chats)
  chatsRef.current = chat.chats
  const selectedPaneId = chat.selectedPaneId
  const dispatch = chat.dispatch
  const title = useCallback((id: string) => chatsRef.current.find((row) => row.paneId === id)?.title ?? 'New chat', [])
  const chatRow = useCallback((id: string) => chatsRef.current.find((row) => row.paneId === id), [])
  const renderPaneRef = useRef<(id: string) => ReactElement>(() => null as unknown as ReactElement)
  const openHistoryChat = useCallback((chatId: string) => layout.activateTab(chatId), [layout.activateTab])
  renderPaneRef.current = (id: string) => (
    <WorkspaceChat paneId={id} dispatch={dispatch}
      appearance={appearance} historyOpen={historyOpen && selectedPaneId === id}
      onHistoryOpenChange={onHistoryOpenChange} dialog={selectedPaneId === id ? dialog : null}
      onDialogChange={onDialogChange} archiveChat={archiveChat}
      openHistoryChat={openHistoryChat}
      onStartAgent={(prompt) => startAgentRef.current(id, prompt)}
      onContinueInNewChat={() => continueChatRef.current(id)}
      onNewChat={() => { void layout.newChat(id) }} />
  )
  const renderPane = useCallback((id: string) => renderPaneRef.current(id), [])
  const renderBrowser = useMemo(() => (
    <div className="workspace-right" data-mode="browser" data-with-browser={layout.browserVisible ? 'yes' : 'no'}>
      <div className={`workspace-surface workspace-surface-browser${layout.browserVisible ? '' : ' is-collapsed'}`}>
        <BrowserPane controller={browser} dragHandle={browserDragHandle} />
      </div>
    </div>
  ), [browser, browserDragHandle, layout.browserVisible])
  const continueChatRef = useRef<(id: string) => Promise<void>>(async () => {})
  const startAgentRef = useRef<(id: string, prompt: string) => Promise<void>>(async () => {})
  startAgentRef.current = async (sourceId, prompt) => {
    onHistoryOpenChange(false)
    const target = sourceId
    await layout.dock(null, target, null, false, async () => {
      const agentPaneId = await window.closedai.chat.newPeer()
      void window.closedai.chat.send(agentPaneId, prompt, []).catch(() => {})
      return agentPaneId
    })
  }
  continueChatRef.current = (id: string): Promise<void> => {
    onHistoryOpenChange(false)
    const row = chatsRef.current.find((entry) => entry.paneId === id)
    return layout.continueChat(id, row?.threadId ?? null, row?.modelId ?? null)
  }
  useImperativeHandle(ref, () => ({
    splitChat: (chatId, edge) => layout.dock(chatId, chat.selectedPaneId, edge),
    activateChat: (chatId) => layout.activateTab(chatId),
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
  const select = useCallback((id: string): void => { void layout.focusPane(id) }, [layout.focusPane])
  const onDock = useCallback((id: string | null, target: string, edge: import('./layout-tree.js').DockEdge | null, singleTab?: boolean) => {
    void layout.dock(id, target, edge, singleTab)
  }, [layout.dock])
  const onSelectTab = useCallback((id: string) => { onHistoryOpenChange(false); void layout.activateTab(id) }, [layout.activateTab, onHistoryOpenChange])
  const onCloseTab = useCallback((id: string) => { void layout.closeTab(id) }, [layout.closeTab])
  const onNewChat = useCallback((id: string) => { onHistoryOpenChange(false); void layout.newChat(id) }, [layout.newChat, onHistoryOpenChange])
  const onTogglePin = useCallback((id: string, pinned: boolean) => { void chat.sidebar.setChatPinned(id, pinned).catch(() => {}) }, [chat.sidebar])
  const onPauseTab = useCallback((id: string) => { void chat.interruptPane(id) }, [chat.interruptPane])
  const onResumeTab = useCallback((id: string) => { void chat.resumePane(id) }, [chat.resumePane])
  const onOpenPresets = useCallback(() => setPresetsOpen(true), [])
  const onHide = useCallback((id: string) => { void layout.hide(id) }, [layout.hide])
  const onSizeChange = useCallback((size: CanvasSize) => { canvasSize.current = size }, [])
  const actions = useMemo(() => ({ moveTab: layout.moveTabToTile }), [layout.moveTabToTile])
  const onRename = useMemo(() => onRenameChat
    ? (id: string) => onRenameChat(id, chatsRef.current.find((row) => row.paneId === id)?.title ?? 'New chat')
    : undefined, [onRenameChat])
  return <div className="chat-desktop-workspace">
    {layout.error && <div className="chat-layout-error" role="alert">{layout.error}</div>}
    <ChatLayoutActions.Provider value={actions}>
    <ChatCanvas tree={layout.tree} selectedId={chat.selectedPaneId} busy={layout.busy}
        notice={layout.notice} toolsPreset={toolsPreset}
        browserRevealVersion={browserRevealVersion}
        onDragActive={setDragging}
        browserVisible={layout.browserVisible}
        title={title}
        reviewQueue={reviewQueue}
        chatRow={chatRow}
        onSelect={select} onDock={onDock} onSelectTab={onSelectTab} onCloseTab={onCloseTab} onNewChat={onNewChat}
        onRenameChat={onRename} onTogglePin={onTogglePin} onContinueChat={(id) => { void continueChatRef.current(id) }}
        onPauseTab={onPauseTab} onResumeTab={onResumeTab} onOpenPresets={onOpenPresets} onSizeChange={onSizeChange}
        onHide={onHide} onResize={layout.resize}
        renderPane={renderPane}
      renderBrowser={renderBrowser}
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
