import { readTreeState, saveTreeState } from '../file-tree/file-tree-state.js'
import { lazy, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactElement, type Ref, type RefObject } from 'react'
import type { BrowserSavedSitesController } from '../browser-saved-sites-controller.js'
import { onAppWindowCommand } from '../app-windows/app-window-store.js'
import { APP_REVEAL_BROWSER_EVENT } from '../../shared/app-ui-events.js'
import { WorkspaceBrowser } from './workspace-browser.js'
import type { AgentRunStartOptions } from '../../shared/agent-runs.js'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import { type useChatController } from '../chat-controller.js'
import { injectComposerDraft } from '../composer-drafts.js'
import type { AppearanceSettings, WorkspaceBackdrop } from '../settings/appearance-settings.js'
import { ChatCanvas } from './chat-canvas.js'
import { ChatLayoutActions } from './layout-context-menu.js'
import { useChatLayout } from './layout-controller.js'
import { paneIds } from './layout-tree.js'
import { BrowserWindowControls } from './floating/window-controls.js'
import { minimizedWindows, type MinimizedWindow } from './floating/minimized-windows.js'
import { hasFloatingWindows } from './floating/window-arrange.js'
import { tabOwner } from './layout-tabs.js'
import { VIEW_LABELS, parseViewTab, type ViewKind } from './layout-views.js'
import { LayoutPresetsDialog } from './layout-presets-dialog.js'
import { AgentsDialog } from '../agent-library/agents-dialog.js'
import type { CanvasSize, LayoutPreset } from './layout-presets.js'
import type { ChatReviewQueue } from '../chat-history/review-queue.js'
import type { HistoryController } from '../chat-history/history-controller.js'
import { WorkspaceChat } from './workspace-chat.js'
import { WorkspacePaneActionsContext, type WorkspacePaneActions } from './workspace-pane-actions.js'
import { WorkspaceViewContext, WorkspaceViewHost, type WorkspaceViewContextValue } from './workspace-view-host.js'
import { chatLayoutRevision } from './layout-revision.js'
import { NotepadView } from '../notepad/notepad-view.js'
import { NotepadHostContext } from '../notepad/notepad-host.js'
import { isNoteTab, noteIdOfTab } from '../notepad/notepad-layout.js'
import { useNotes } from '../notepad/notes-client.js'
import { useNotepadHost } from '../notepad/use-notepad-host.js'
import { FileView } from '../file-viewer/file-view.js'
import { filePathFromViewTab, fileViewKey, fileViewTabId, fileViewTitle, setFileViewTarget } from './file-view-layout.js'
import { isBrowserDocumentFile, type LocalFileOpenOptions } from '../../shared/local-files.js'

const FileTreePanel = lazy(async () => {
  const module = await import('../file-tree/file-tree-panel.js')
  return { default: module.FileTreePanel }
})

export type ChatLayoutHandle = {
  splitChat: (chatId: string, edge: 'right' | 'bottom') => Promise<void>
  /** Open or focus a saved chat and sync the tab strip before the transcript paints. */
  activateChat: (chatId: string) => Promise<void>
  /** Open or focus a view in a window of its own (Agent and Developer menus, shortcuts). */
  openView: (kind: ViewKind) => void
  /** The Agents dialog, starting runs beside the selected chat. */
  openAgents: () => void
  /** Close the view of this kind when it is in front of its window, else open it (View → history). */
  toggleView: (kind: ViewKind) => Promise<void>
  toggleBrowser: () => void
  toggleFiles: () => void
  /** Show the browser and open or focus the video library tab. */
  openVideoHub: () => Promise<void>
  /** Show the browser and load `url` in it (the dock's saved sites). */
  openSite: (url: string) => Promise<void>
  focusedCloseTarget: () => string
  closeFocused: () => Promise<void>
  openLayoutPresets: () => void
  applyPreset: (preset: LayoutPreset) => void
  /** Bring a minimized window back from the dock. */
  restoreWindow: (id: string) => void
  /** Tile windows: every floating window back into the last tiled layout (dock, View menu, Ctrl+Shift+L). */
  tileWindows: () => void
  /** Selected chat and browser back into the compact floating pair (View menu, Ctrl+Shift+B). */
  restoreFloatingPair: () => void
  /** Put text in a chat's composer and bring that chat forward (Start's Tools view). */
  sendToChat: (chatId: string, text: string) => void
  /** Start a run in a new chat beside `chatId`'s tile (Start's Agents view). */
  startAgent: (chatId: string, options: AgentRunStartOptions) => Promise<void>
  /** The notepad: its open window in front, else the latest note, else a new note (dock, menu). */
  openNotepad: () => Promise<void>
  newChatWindow: () => Promise<void>
}

export function DesktopWorkspace({ chat, savedSites, reviewQueue, appearance, onBackdropChange, onOpenWallpaper, toolsPreset = null, browserHeld = false, spaceId, onRenameChat, onSavedSitesError, onNotepadError, onFilesVisibleChange, onBrowserVisibleChange, onMinimizedChange, onFloatingChange, archiveChat, onChatTabClosed, threadSearch, ref }: {
  chat: ReturnType<typeof useChatController>
  savedSites: BrowserSavedSitesController
  reviewQueue: ChatReviewQueue
  appearance: AppearanceSettings
  onBackdropChange: (mode: WorkspaceBackdrop) => void
  /** Open the wallpaper picker from the canvas background menu. */
  onOpenWallpaper: () => void
  toolsPreset?: 'full' | 'read-only' | 'custom' | null
  /** Zoomed out to the spaces overview: the browser shows its still and the page keeps its bounds. */
  browserHeld?: boolean
  /** The space this workspace shows; its id names the saved layout. */
  spaceId?: string
  onRenameChat?: (id: string, title: string) => void
  onSavedSitesError?: (reason: unknown) => void
  onNotepadError?: (reason: unknown) => void
  /** Whether this workspace shows its Files sidebar, for the dock toggle. */
  onFilesVisibleChange?: (visible: boolean) => void
  /** Whether this workspace shows its browser, for controls outside it (the dock). */
  onBrowserVisibleChange?: (visible: boolean) => void
  /** Windows minimized to the dock, for the dock outside this workspace. */
  onMinimizedChange?: (windows: MinimizedWindow[]) => void
  /** Whether any window floats, so Tile windows outside this workspace knows it has work. */
  onFloatingChange?: (floating: boolean) => void
  archiveChat?: (chatId: string) => Promise<void>
  /** Clears completion review when the user closes a chat tab or hides its window tile. */
  onChatTabClosed?: (chatId: string) => void
  threadSearch?: {
    chats: ChatRowSummary[]
    controller: HistoryController
    inputRef: RefObject<HTMLInputElement | null>
  }
  ref?: Ref<ChatLayoutHandle>
}) {
  const filesRoot = chat.workspace?.cwd ?? chat.state.cwd
  const filesKey = `closedai.files.visible:${filesRoot}`
  const [filesVisible, setFilesVisible] = useState(() => readTreeState<boolean>(filesKey, false) === true)
  useEffect(() => { setFilesVisible(readTreeState<boolean>(filesKey, false) === true) }, [filesKey])
  useEffect(() => { onFilesVisibleChange?.(filesVisible) }, [filesVisible, onFilesVisibleChange])
  const toggleFiles = useCallback(() => setFilesVisible(value => { saveTreeState(filesKey, !value); return !value }), [filesKey])
  const workspaceSnapshotRef = useRef(chat.snapshot)
  workspaceSnapshotRef.current = chat.snapshot
  const layoutRevision = chatLayoutRevision(chat.snapshot)
  const layout = useChatLayout(() => workspaceSnapshotRef.current, layoutRevision, spaceId, onChatTabClosed)
  const maximized = useMemo((): [string | null, typeof layout.setMaximized] => [layout.maximized, layout.setMaximized], [layout.maximized, layout.setMaximized])
  // The canvas moves the browser window from a press on this grip, as it does a chat's.
  const browserDragHandle = useMemo(() => <button type="button"
    className="browser-layout-drag" data-ui="layout.browser-drag" data-window-grip="" disabled={layout.busy}
    aria-label="Move browser window" title="Drag to move the browser window: to a workspace edge or a chat's edge to tile it"
  ><span className="browser-layout-drag-dots" aria-hidden="true" /></button>, [layout.busy])
  const [layoutDragging, setLayoutDragging] = useState(false)
  const [browserCovered, setBrowserCovered] = useState(false)
  const [browserRevealVersion, setBrowserRevealVersion] = useState(0)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [agentsMenuPaneId, setAgentsMenuPaneId] = useState<string | null>(null)
  // The chat the Agents dialog was opened from; null while it is closed.
  const [agentsAnchor, setAgentsAnchor] = useState<string | null>(null)
  const canvasSize = useRef<CanvasSize>({ width: 0, height: 0 })
  const chatsRef = useRef(chat.chats)
  chatsRef.current = chat.chats
  const dispatch = chat.dispatch
  const chatTitle = useCallback((id: string) => chatsRef.current.find((row) => row.paneId === id)?.title ?? 'New chat', [])
  const notes = useNotes()
  const title = useCallback((id: string) => {
    const view = parseViewTab(id)
    const noteId = view?.kind === 'note' ? noteIdOfTab(id) : null
    if (noteId) return notes.find((note) => note.id === noteId)?.title ?? VIEW_LABELS.note
    const filePath = view?.kind === 'file' ? filePathFromViewTab(id) : null
    if (filePath) return fileViewTitle(filePath)
    return view ? VIEW_LABELS[view.kind] : chatTitle(id)
  }, [chatTitle, notes])
  const chatRow = useCallback((id: string) => chatsRef.current.find((row) => row.paneId === id), [])
  const renderPaneRef = useRef<(id: string, visible: boolean) => ReactElement>(() => null as unknown as ReactElement)
  renderPaneRef.current = (id: string, visible: boolean) => {
    const view = parseViewTab(id)
    if (view?.kind === 'note') return <NotepadView tabId={view.id} active={visible} />
    if (view?.kind === 'file') return <FileView tabId={view.id} active={visible} />
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
  // Minimizing the browser hides it; the dock's Browser icon brings it back.
  const browserControls = useMemo(() => <BrowserWindowControls busy={layout.busy} onMinimize={layout.toggleBrowser} />,
    [layout.busy, layout.toggleBrowser])
  const reportNotepadError = useCallback((reason: unknown) => { onNotepadError?.(reason) }, [onNotepadError])
  const notepad = useNotepadHost({ layout, chats: chat.chats, dispatch, appearance, onError: reportNotepadError })
  const renderBrowser = useMemo(() => layout.detached ? null : <WorkspaceBrowser
    layoutKey={`${layoutRevision}\0${layout.browserVisible ? '1' : '0'}`} visible={layout.browserVisible}
    occluded={layoutDragging || browserHeld || browserCovered}
    savedSites={savedSites} dragHandle={browserDragHandle} windowControls={browserControls}
    onReveal={revealBrowser} onShow={layout.showBrowser} />,
  [layout.detached, layoutRevision, layout.browserVisible, layoutDragging, browserHeld, browserCovered, savedSites, browserDragHandle,
    browserControls, revealBrowser, layout.showBrowser])
  // The browser lives in the main window: a detached window's Browser control brings that forward.
  const toggleBrowserHere = useCallback(() => {
    if (layout.detached) { void window.closedai.windows.showBrowser(); return }
    layout.toggleBrowser()
    setBrowserRevealVersion((value) => value + 1)
  }, [layout.detached, layout.toggleBrowser])
  useEffect(() => onAppWindowCommand((command) => { if (command.type === 'showBrowser') revealBrowser() }), [revealBrowser])
  useEffect(() => {
    // Workspace previews (closedai_app.command preview_html) show the pane through the ui host.
    window.addEventListener(APP_REVEAL_BROWSER_EVENT, revealBrowser)
    return () => window.removeEventListener(APP_REVEAL_BROWSER_EVENT, revealBrowser)
  }, [revealBrowser])
  useEffect(() => { onBrowserVisibleChange?.(layout.browserVisible) }, [layout.browserVisible, onBrowserVisibleChange])
  const minimized = useMemo(() => minimizedWindows(layout.tree, title), [layout.tree, title, chat.chats])
  const minimizedKey = JSON.stringify(minimized)
  useEffect(() => { onMinimizedChange?.(JSON.parse(minimizedKey) as MinimizedWindow[]) }, [minimizedKey, onMinimizedChange])
  useEffect(() => () => onMinimizedChange?.([]), [onMinimizedChange])
  const floating = hasFloatingWindows(layout.tree)
  useEffect(() => { onFloatingChange?.(floating) }, [floating, onFloatingChange])
  useEffect(() => () => onFloatingChange?.(false), [onFloatingChange])
  // A repair draft from the Tools view lands in the scoped chat's composer and brings that chat forward.
  const sendToChat = useCallback((chatId: string, text: string) => {
    injectComposerDraft(chatId, text)
    void layout.activateTab(chatId)
  }, [layout.activateTab])
  useImperativeHandle(ref, () => ({
    splitChat: (chatId, edge) => layout.dock(chatId, chat.selectedPaneId, edge),
    activateChat: (chatId) => layout.activateTab(chatId),
    openView: (kind) => layout.openView(kind, chat.selectedPaneId),
    openAgents: () => setAgentsAnchor(chat.selectedPaneId),
    toggleView: (kind) => layout.toggleView(kind),
    toggleBrowser: toggleBrowserHere,
    toggleFiles,
    openVideoHub: async () => {
      revealBrowser()
      await window.closedai.browser.openVideoHub()
    },
    openSite: async (url) => {
      revealBrowser()
      await savedSites.open(url)
    },
    focusedCloseTarget: layout.focusedCloseTarget,
    closeFocused: () => layout.closeFocused(),
    openLayoutPresets: () => setPresetsOpen(true),
    applyPreset: (preset) => {
      setBrowserRevealVersion((value) => value + 1)
      void layout.arrange(preset, canvasSize.current)
    },
    restoreWindow: (id) => layout.windows.restore(id),
    tileWindows: () => {
      setBrowserRevealVersion((value) => value + 1)
      layout.windows.tileAll()
    },
    restoreFloatingPair: () => {
      setBrowserRevealVersion((value) => value + 1)
      layout.restoreFloatingPair()
    },
    sendToChat,
    startAgent: (chatId, options) => startAgentRef.current(chatId, options),
    openNotepad: notepad.openNotepad,
    newChatWindow: layout.newChatWindow
  }), [toggleFiles, notepad.openNotepad, layout.newChatWindow, layout.windows, layout.dock, layout.activateTab, layout.openView, layout.toggleView, toggleBrowserHere, revealBrowser, savedSites, layout.closeFocused, layout.focusedCloseTarget, layout.arrange, chat.selectedPaneId, sendToChat])
  const select = useCallback((id: string): void => { void layout.focusPane(id) }, [layout.focusPane])
  const onDock = useCallback((id: string | null, target: string, edge: import('./layout-tree.js').DockEdge | null, singleTab?: boolean) => {
    return layout.dock(id, target, edge, singleTab)
  }, [layout.dock])
  const onSelectTab = useCallback((id: string) => { void layout.activateTab(id) }, [layout.activateTab])
  const onCloseTab = useCallback((id: string) => { void layout.closeTab(id) }, [layout.closeTab])
  const onNewChat = useCallback((id: string) => {
    if (isNoteTab(id)) void notepad.newNote(id)
    else void layout.newChat(id)
  }, [layout.newChat, notepad.newNote])
  const onTogglePin = useCallback((id: string, pinned: boolean) => { void chat.sidebar.setChatPinned(id, pinned).catch(() => {}) }, [chat.sidebar])
  const onPauseTab = useCallback((id: string) => { void chat.interruptPane(id) }, [chat.interruptPane])
  const onResumeTab = useCallback((id: string) => { void chat.resumePane(id) }, [chat.resumePane])
  const onOpenPresets = useCallback(() => setPresetsOpen(true), [])
  const onHide = useCallback((id: string) => { void layout.hide(id) }, [layout.hide])
  const onSizeChange = useCallback((size: CanvasSize) => {
    canvasSize.current = size
    layout.setCanvasSize(size)
  }, [layout.setCanvasSize])
  const actions = useMemo(() => ({
    moveTab: layout.moveTabToTile,
    detachTab: (id: string) => { void layout.detachTab(id) },
    returnTab: layout.detached ? (id: string) => { void layout.returnTab(id) } : undefined
  }), [layout.moveTabToTile, layout.detachTab, layout.returnTab, layout.detached])
  const onRename = useMemo(() => onRenameChat
    ? (id: string) => onRenameChat(id, chatsRef.current.find((row) => row.paneId === id)?.title ?? 'New chat')
    : undefined, [onRenameChat])
  const startAgent = useCallback((chatId: string, options: AgentRunStartOptions) => startAgentRef.current(chatId, options), [])
  const closeAgents = useCallback(() => setAgentsAnchor(null), [])
  const openAgentChat = useCallback((chatId: string) => { void layout.activateTab(chatId) }, [layout.activateTab])
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
  // Text files open in a file window, never in the browser or beside chats; pages, PDFs and media
  // still open in the browser.
  const openFile = useCallback(async (href: string, options?: LocalFileOpenOptions) => {
    const preview = await window.closedai.localFiles.preview(href, options)
    if (preview.kind === 'revealed') return
    if (preview.kind === 'file' && (preview.line || preview.diff || !isBrowserDocumentFile(preview.path))) {
      const { kind: _kind, path, ...target } = preview
      setFileViewTarget(fileViewTabId(path), target)
      layout.openView('file', chat.selectedPaneId, fileViewKey(path))
      return
    }
    await window.closedai.localFiles.open(href, options)
    revealBrowser()
  }, [layout.openView, chat.selectedPaneId, revealBrowser])
  const openTreeFile = useCallback((path: string) => openFile(path, { literalPath: true, cwd: filesRoot }), [openFile, filesRoot])
  const focusChatTab = useCallback((chatId: string, anchorPaneId: string) => {
    const tile = tabOwner(layout.tree, anchorPaneId) ?? anchorPaneId
    return layout.activateTab(chatId, tile)
  }, [layout.activateTab, layout.tree])
  const paneActions = useMemo<WorkspacePaneActions>(() => ({
    toggleBrowser: toggleBrowserHere,
    openFile,
    newChat: (paneId) => { void layout.newChat(paneId) },
    openAgentsView: setAgentsAnchor,
    focusChatTab,
    startAgentFromPane: (paneId, options) => startAgentRef.current(paneId, options),
    agentsMenuPaneId,
    setAgentsMenuPaneId
  }), [toggleBrowserHere, openFile, layout.newChat, focusChatTab, agentsMenuPaneId])
  const viewContext = useMemo<WorkspaceViewContextValue>(() => ({
    tree: layout.tree, views: layout.views, selectedPaneId: chat.selectedPaneId, chats: chat.chats, title: chatTitle,
    listChats: chat.listChats, archiveChat: archiveChat ?? chat.archiveChat, activateChat: layout.activateTab,
    pinView: layout.pinView, closeTab: onCloseTab, sendToChat, savedSites: savedSitesView,
    onSavedSitesError: reportSavedSitesError
  }), [layout.tree, layout.views, chat.selectedPaneId, chat.chats, chatTitle, chat.listChats, archiveChat, chat.archiveChat,
    layout.activateTab, layout.pinView, onCloseTab, sendToChat, savedSitesView, reportSavedSitesError])
  return <div className="chat-desktop-workspace">
    {layout.error && <div className="chat-layout-error" role="alert">{layout.error}</div>}
    <ChatLayoutActions.Provider value={actions}>
    <WorkspacePaneActionsContext.Provider value={paneActions}>
    <WorkspaceViewContext.Provider value={viewContext}>
    <NotepadHostContext.Provider value={notepad}>
    <div className="workspace-files-row">
    {filesVisible && filesRoot ? <Suspense fallback={null}>
      <FileTreePanel key={filesRoot} root={filesRoot} active={!browserHeld} onClose={toggleFiles} onOpen={openTreeFile} />
    </Suspense> : null}
    <div className="workspace-files-canvas">
    <ChatCanvas tree={layout.tree} selectedId={chat.selectedPaneId} busy={layout.busy}
        notice={layout.notice} toolsPreset={toolsPreset}
        browserRevealVersion={browserRevealVersion} maximized={maximized}
        onDragActive={setLayoutDragging}
        browserVisible={layout.browserVisible}
        title={title}
        reviewQueue={reviewQueue}
        chatRow={chatRow}
        onSelect={select} onDock={onDock} onSelectTab={onSelectTab} onCloseTab={onCloseTab} onNewChat={onNewChat}
        onRenameChat={onRename} onTogglePin={onTogglePin}
        onPauseTab={onPauseTab} onResumeTab={onResumeTab} onOpenPresets={onOpenPresets} onSizeChange={onSizeChange}
        onHide={onHide} onResize={layout.resize} windows={layout.windows} onBrowserCovered={setBrowserCovered}
        backdrop={appearance.backdrop} onBackdropChange={onBackdropChange} onOpenWallpaper={onOpenWallpaper}
        threadSearch={threadSearch}
        renderPane={renderPane}
      renderBrowser={renderBrowser}
    />
    </div>
    </div>
    </NotepadHostContext.Provider>
    </WorkspaceViewContext.Provider>
    </WorkspacePaneActionsContext.Provider>
    </ChatLayoutActions.Provider>
    <AgentsDialog anchor={agentsAnchor} chats={chat.chats} onClose={closeAgents} onOpenChat={openAgentChat} onStart={startAgent} />
    <LayoutPresetsDialog open={presetsOpen} size={canvasSize.current} tileCount={paneIds(layout.tree).length}
      onClose={() => setPresetsOpen(false)}
      onApply={(preset) => {
        setBrowserRevealVersion((value) => value + 1)
        void layout.arrange(preset, canvasSize.current)
      }} />
  </div>
}
