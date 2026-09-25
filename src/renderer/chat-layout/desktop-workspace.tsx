import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactElement, type Ref } from 'react'
import type { BrowserSavedSitesController } from '../browser-saved-sites-controller.js'
import { onAppWindowCommand } from '../app-windows/app-window-store.js'
import { WorkspaceBrowser } from './workspace-browser.js'
import type { AgentRunStartOptions } from '../../shared/agent-runs.js'
import { type useChatController } from '../chat-controller.js'
import { injectComposerDraft } from '../composer-drafts.js'
import type { AppearanceSettings } from '../settings/appearance-settings.js'
import { ChatCanvas } from './chat-canvas.js'
import { ChatLayoutActions } from './layout-context-menu.js'
import { useChatLayout } from './layout-controller.js'
import { BROWSER_PANE_ID, CHAT_DRAG_TYPE, paneIds } from './layout-tree.js'
import { tabOwner } from './layout-tabs.js'
import { VIEW_LABELS, parseViewTab, type ViewKind } from './layout-views.js'
import { LayoutPresetsDialog } from './layout-presets-dialog.js'
import type { CanvasSize, LayoutPreset } from './layout-presets.js'
import type { ChatReviewQueue } from '../chat-history/review-queue.js'
import { WorkspaceChat } from './workspace-chat.js'
import { WorkspacePaneActionsContext, type WorkspacePaneActions } from './workspace-pane-actions.js'
import { WorkspaceViewContext, WorkspaceViewHost, type WorkspaceViewContextValue } from './workspace-view-host.js'
import { chatLayoutRevision } from './layout-revision.js'

export type ChatLayoutHandle = {
  splitChat: (chatId: string, edge: 'right' | 'bottom') => Promise<void>
  /** Open or focus a saved chat and sync the tab strip before the transcript paints. */
  activateChat: (chatId: string) => Promise<void>
  /** Open or focus a view tab in the selected chat's tile (Agent and Developer menus, shortcuts). */
  openView: (kind: ViewKind) => void
  /** Close the selected tile's view of this kind when it is in front, else open it (View → history). */
  toggleView: (kind: ViewKind) => Promise<void>
  toggleBrowser: () => void
  closeFocused: () => Promise<void>
  openLayoutPresets: () => void
  applyPreset: (preset: LayoutPreset) => void
}

export function DesktopWorkspace({ chat, savedSites, reviewQueue, appearance, toolsPreset = null, onRenameChat, onSavedSitesError, archiveChat, ref }: {
  chat: ReturnType<typeof useChatController>
  savedSites: BrowserSavedSitesController
  reviewQueue: ChatReviewQueue
  appearance: AppearanceSettings
  toolsPreset?: 'full' | 'read-only' | 'custom' | null
  onRenameChat?: (id: string, title: string) => void
  onSavedSitesError?: (reason: unknown) => void
  archiveChat?: (chatId: string) => Promise<void>
  ref?: Ref<ChatLayoutHandle>
}) {
  const workspaceSnapshotRef = useRef(chat.snapshot)
  workspaceSnapshotRef.current = chat.snapshot
  const layoutRevision = chatLayoutRevision(chat.snapshot)
  const layout = useChatLayout(() => workspaceSnapshotRef.current, layoutRevision)
  const browserDragHandle = useMemo(() => <button type="button"
    className="browser-layout-drag" data-ui="layout.browser-drag" draggable={!layout.busy} disabled={layout.busy}
    aria-label="Move browser" title="Drag above or beside a chat; drop at the workspace edge for a full-height column"
    onDragStart={(event) => {
      event.dataTransfer.setData(CHAT_DRAG_TYPE, BROWSER_PANE_ID)
      event.dataTransfer.effectAllowed = 'move'
    }}><span className="browser-layout-drag-dots" aria-hidden="true" /></button>, [layout.busy])
  const [layoutDragging, setLayoutDragging] = useState(false)
  const [browserRevealVersion, setBrowserRevealVersion] = useState(0)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [agentsMenuPaneId, setAgentsMenuPaneId] = useState<string | null>(null)
  const canvasSize = useRef<CanvasSize>({ width: 0, height: 0 })
  const chatsRef = useRef(chat.chats)
  chatsRef.current = chat.chats
  const dispatch = chat.dispatch
  const chatTitle = useCallback((id: string) => chatsRef.current.find((row) => row.paneId === id)?.title ?? 'New chat', [])
  const title = useCallback((id: string) => {
    const view = parseViewTab(id)
    return view ? VIEW_LABELS[view.kind] : chatTitle(id)
  }, [chatTitle])
  const chatRow = useCallback((id: string) => chatsRef.current.find((row) => row.paneId === id), [])
  const renderPaneRef = useRef<(id: string, visible: boolean) => ReactElement>(() => null as unknown as ReactElement)
  renderPaneRef.current = (id: string, visible: boolean) => {
    const view = parseViewTab(id)
    if (view) return <WorkspaceViewHost viewId={view.id} kind={view.kind} />
    return <WorkspaceChat paneId={id} dispatch={dispatch} appearance={appearance} panelVisible={visible}
      onContinueInNewChat={() => continueChatRef.current(id)}
      onNewChat={() => { void layout.newChat(id) }} />
  }
  const renderPane = useCallback((id: string, visible: boolean) => renderPaneRef.current(id, visible), [])
  const continueChatRef = useRef<(id: string) => Promise<void>>(async () => {})
  const startAgentRef = useRef<(id: string, options: AgentRunStartOptions) => Promise<void>>(async () => {})
  startAgentRef.current = async (launchPaneId, options) => {
    // Dock beside the launching chat's tile; inherit its model and folder for the new run chat.
    const target = tabOwner(layout.tree, launchPaneId) ?? launchPaneId
    let startError: unknown = null
    let agentPaneId: string | null = null
    await layout.dock(null, target, null, false, async () => {
      await window.closedai.chat.selectPane(launchPaneId)
      agentPaneId = await window.closedai.chat.newPeer()
      try {
        await window.closedai.agentRuns.start(agentPaneId, options)
      } catch (error) {
        startError = error
      }
      return agentPaneId
    })
    if (startError) throw startError
    if (agentPaneId) await layout.activateTab(agentPaneId, target)
  }
  continueChatRef.current = (id: string): Promise<void> => {
    const row = chatsRef.current.find((entry) => entry.paneId === id)
    return layout.continueChat(id, row?.threadId ?? null, row?.modelId ?? null)
  }
  const revealBrowser = useCallback(() => {
    layout.showBrowser()
    setBrowserRevealVersion((value) => value + 1)
  }, [layout.showBrowser])
  const renderBrowser = useMemo(() => layout.detached ? null : <WorkspaceBrowser
    layoutKey={`${layoutRevision}\0${layout.browserVisible ? '1' : '0'}`} visible={layout.browserVisible} occluded={layoutDragging}
    savedSites={savedSites} dragHandle={browserDragHandle} onReveal={revealBrowser} onShow={layout.showBrowser} />,
  [layout.detached, layoutRevision, layout.browserVisible, layoutDragging, savedSites, browserDragHandle, revealBrowser, layout.showBrowser])
  // The browser lives in the main window: a detached window's Browser control brings that forward.
  const toggleBrowserHere = useCallback(() => {
    if (layout.detached) { void window.closedai.windows.showBrowser(); return }
    layout.toggleBrowser()
    setBrowserRevealVersion((value) => value + 1)
  }, [layout.detached, layout.toggleBrowser])
  useEffect(() => onAppWindowCommand((command) => { if (command.type === 'showBrowser') revealBrowser() }), [revealBrowser])
  useImperativeHandle(ref, () => ({
    splitChat: (chatId, edge) => layout.dock(chatId, chat.selectedPaneId, edge),
    activateChat: (chatId) => layout.activateTab(chatId),
    openView: (kind) => layout.openView(kind, chat.selectedPaneId),
    toggleView: (kind) => layout.toggleView(kind),
    toggleBrowser: toggleBrowserHere,
    closeFocused: () => layout.closeFocused(),
    openLayoutPresets: () => setPresetsOpen(true),
    applyPreset: (preset) => {
      setBrowserRevealVersion((value) => value + 1)
      void layout.arrange(preset, canvasSize.current)
    }
  }), [layout.dock, layout.activateTab, layout.openView, layout.toggleView, toggleBrowserHere, layout.closeFocused, layout.arrange, chat.selectedPaneId])
  const select = useCallback((id: string): void => { void layout.focusPane(id) }, [layout.focusPane])
  const onDock = useCallback((id: string | null, target: string, edge: import('./layout-tree.js').DockEdge | null, singleTab?: boolean) => {
    return layout.dock(id, target, edge, singleTab)
  }, [layout.dock])
  const onSelectTab = useCallback((id: string) => { void layout.activateTab(id) }, [layout.activateTab])
  const onCloseTab = useCallback((id: string) => { void layout.closeTab(id) }, [layout.closeTab])
  const onNewChat = useCallback((id: string) => { void layout.newChat(id) }, [layout.newChat])
  const onTogglePin = useCallback((id: string, pinned: boolean) => { void chat.sidebar.setChatPinned(id, pinned).catch(() => {}) }, [chat.sidebar])
  const onPauseTab = useCallback((id: string) => { void chat.interruptPane(id) }, [chat.interruptPane])
  const onResumeTab = useCallback((id: string) => { void chat.resumePane(id) }, [chat.resumePane])
  const onOpenPresets = useCallback(() => setPresetsOpen(true), [])
  const onHide = useCallback((id: string) => { void layout.hide(id) }, [layout.hide])
  const onSizeChange = useCallback((size: CanvasSize) => { canvasSize.current = size }, [])
  const actions = useMemo(() => ({
    moveTab: layout.moveTabToTile,
    detachTab: (id: string) => { void layout.detachTab(id) },
    returnTab: layout.detached ? (id: string) => { void layout.returnTab(id) } : undefined
  }), [layout.moveTabToTile, layout.detachTab, layout.returnTab, layout.detached])
  const onRename = useMemo(() => onRenameChat
    ? (id: string) => onRenameChat(id, chatsRef.current.find((row) => row.paneId === id)?.title ?? 'New chat')
    : undefined, [onRenameChat])
  // A repair draft from the Tools view lands in the scoped chat's composer and brings that chat forward.
  const sendToChat = useCallback((chatId: string, text: string) => {
    injectComposerDraft(chatId, text)
    void layout.activateTab(chatId)
  }, [layout.activateTab])
  const startAgent = useCallback((chatId: string, options: AgentRunStartOptions) => startAgentRef.current(chatId, options), [])
  const openSavedSite = useCallback(async (url: string) => {
    revealBrowser()
    await savedSites.open(url)
  }, [revealBrowser, savedSites])
  const savedSitesView = useMemo(() => ({
    update: savedSites.update,
    remove: savedSites.remove,
    openSite: openSavedSite
  }), [savedSites.update, savedSites.remove, openSavedSite])
  const reportSavedSitesError = useCallback((reason: unknown) => { onSavedSitesError?.(reason) }, [onSavedSitesError])
  const focusChatTab = useCallback((chatId: string, anchorPaneId: string) => {
    const tile = tabOwner(layout.tree, anchorPaneId) ?? anchorPaneId
    return layout.activateTab(chatId, tile)
  }, [layout.activateTab, layout.tree])
  const paneActions = useMemo<WorkspacePaneActions>(() => ({
    toggleBrowser: toggleBrowserHere,
    newChat: (paneId) => { void layout.newChat(paneId) },
    openAgentsView: (anchorPaneId) => layout.openView('agents', anchorPaneId),
    focusChatTab,
    startAgentFromPane: (paneId, options) => startAgentRef.current(paneId, options),
    agentsMenuPaneId,
    setAgentsMenuPaneId
  }), [toggleBrowserHere, layout.newChat, layout.openView, focusChatTab, agentsMenuPaneId])
  const viewContext = useMemo<WorkspaceViewContextValue>(() => ({
    tree: layout.tree, views: layout.views, selectedPaneId: chat.selectedPaneId, chats: chat.chats, title: chatTitle,
    listChats: chat.listChats, archiveChat: archiveChat ?? chat.archiveChat, activateChat: layout.activateTab,
    pinView: layout.pinView, closeTab: onCloseTab, sendToChat, startAgent, savedSites: savedSitesView,
    onSavedSitesError: reportSavedSitesError
  }), [layout.tree, layout.views, chat.selectedPaneId, chat.chats, chatTitle, chat.listChats, archiveChat, chat.archiveChat,
    layout.activateTab, layout.pinView, onCloseTab, sendToChat, startAgent, savedSitesView, reportSavedSitesError])
  return <div className="chat-desktop-workspace">
    {layout.error && <div className="chat-layout-error" role="alert">{layout.error}</div>}
    <ChatLayoutActions.Provider value={actions}>
    <WorkspacePaneActionsContext.Provider value={paneActions}>
    <WorkspaceViewContext.Provider value={viewContext}>
    <ChatCanvas tree={layout.tree} selectedId={chat.selectedPaneId} busy={layout.busy}
        notice={layout.notice} toolsPreset={toolsPreset}
        browserRevealVersion={browserRevealVersion}
        onDragActive={setLayoutDragging}
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
    </WorkspaceViewContext.Provider>
    </WorkspacePaneActionsContext.Provider>
    </ChatLayoutActions.Provider>
    <LayoutPresetsDialog open={presetsOpen} size={canvasSize.current} tileCount={paneIds(layout.tree).length}
      onClose={() => setPresetsOpen(false)}
      onApply={(preset) => {
        setBrowserRevealVersion((value) => value + 1)
        void layout.arrange(preset, canvasSize.current)
      }} />
  </div>
}
