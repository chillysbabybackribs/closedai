import type { JSX } from 'react'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/inter/wght-italic.css'
import '@fontsource-variable/geist-mono/wght.css'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { APP_REVEAL_CHAT_TAB_EVENT, type AppRevealChatTabDetail } from '../shared/app-ui-events.js'
import { HeaderChatSearch } from './chat-history/header-search.js'
import { useHistoryController } from './chat-history/history-controller.js'
import { AppWindowControls } from './app-window-controls.js'
import { appWindow } from './app-windows/app-window-store.js'
import { useChatController } from './chat-controller.js'
import {
  applyChatZoomCommand,
  chatZoomCommandForKey,
  type ChatZoomCommand
} from './chat-zoom.js'
import { appShortcutForKey, escapePausesTask, targetRunningPaneId } from './app-shortcuts.js'
import { AppStartup } from './app-startup.js'
import { errorMessage } from './error-message.js'
import { providerSupportsContextShrink } from './context-shrink-eligibility.js'
import { TitlebarMenu, type MenuAction, type TitlebarMenuProps } from './titlebar-menu.js'
import { useMenuRunBridge } from './menu-run-bridge.js'
import { DesktopWorkspace, type ChatLayoutHandle } from './chat-layout/desktop-workspace.js'
import { ChatRenameDialog } from './chat-rename-dialog.js'
import { SpacesStage, type SpacesDockNav, type SpacesHandle } from './spaces/spaces-stage.js'
import { AppDock } from './dock/app-dock.js'
import { TitlebarRail } from './rail/titlebar-rail.js'
import { DOCK_RESERVE, readDockPrefs, saveDockPrefs, type DockPrefs } from './dock/dock-model.js'
import type { LayoutPreset } from './chat-layout/layout-presets.js'
import type { AgentRunStartOptions } from '../shared/agent-runs.js'
import type { AppDockProps } from './dock/app-dock.js'
import type { SettingsTab } from './settings/settings-sections.js'
import type { StartServices } from './dock/dock-start-views.js'

const SettingsDialog = lazy(async () => {
  const module = await import('./settings/settings-dialog.js')
  return { default: module.SettingsDialog }
})
const WallpaperDialog = lazy(async () => {
  const module = await import('./backdrop/wallpaper-dialog.js')
  return { default: module.WallpaperDialog }
})
import { useToolsPreset } from './tools/use-tools-preset.js'
import { useBrowserSavedSitesController } from './browser-saved-sites-controller.js'
import {
  normalizeAppearanceSettings,
  persistAppearanceSettings,
  readAppearanceSettings,
  type AppearanceSettings
} from './settings/appearance-settings.js'
import { useWorkspaceBackdrop } from './backdrop/use-workspace-backdrop.js'
import type { MinimizedWindow } from './chat-layout/floating/minimized-windows.js'
import { ProviderSetupModal } from './onboarding/provider-setup-modal.js'
import { SessionAccountMenu } from './onboarding/session-account-menu.js'
import { SessionGate } from './onboarding/session-gate.js'
import { ProfileSwitchCover } from './onboarding/session-gate-parts.js'
import { useOnboarding } from './onboarding/use-onboarding.js'
import './styles.css'

export function App({ initialSettingsOpen = false }: { initialSettingsOpen?: boolean }): JSX.Element {
  const chat = useChatController()
  const chatRef = useRef(chat)
  chatRef.current = chat
  const workspaceRef = useRef<ChatLayoutHandle>(null)
  const spacesRef = useRef<SpacesHandle>(null)
  const openHistoryChat = useCallback(async (chatId: string) => {
    await (workspaceRef.current?.activateChat(chatId) ?? chatRef.current.openChat(chatId))
  }, [])
  useEffect(() => {
    const onReveal = (event: Event): void => {
      const paneId = (event as CustomEvent<AppRevealChatTabDetail>).detail?.paneId
      if (!paneId) return
      void openHistoryChat(paneId)
    }
    window.addEventListener(APP_REVEAL_CHAT_TAB_EVENT, onReveal)
    return () => window.removeEventListener(APP_REVEAL_CHAT_TAB_EVENT, onReveal)
  }, [openHistoryChat])
  const history = useHistoryController(chat.sidebar, openHistoryChat)
  const searchRef = useRef<HTMLInputElement>(null)
  const [searchTools, setSearchTools] = useState<HTMLDivElement | null>(null)
  const focusSearch = useCallback(() => { searchRef.current?.focus(); searchRef.current?.select() }, [])
  const [appearance, setAppearance] = useState(() => readAppearanceSettings(window.localStorage))
  const backdropStatus = useWorkspaceBackdrop(appearance.backdrop)
  const legacyOnboardingBypass = chat.chats.length > 0
  const onboarding = useOnboarding(chat.state, legacyOnboardingBypass)
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance')
  const [wallpaperOpen, setWallpaperOpen] = useState(false)
  // The picker previews live on the workspace, so Settings steps aside instead of covering it.
  const openWallpaper = useCallback(() => {
    setSettingsOpen(false)
    setWallpaperOpen(true)
  }, [])
  const [renamingChat, setRenamingChat] = useState<{ id: string; title: string } | null>(null)
  const dialogsRef = useRef({ settingsOpen, renamingChat })
  dialogsRef.current = { settingsOpen, renamingChat }
  const toolsPreset = useToolsPreset()
  const [dockPrefs, setDockPrefs] = useState(() => readDockPrefs(window.localStorage))
  const updateDockPrefs = useCallback((patch: Partial<DockPrefs>): void => {
    setDockPrefs((current) => {
      const next = { ...current, ...patch }
      saveDockPrefs(window.localStorage, next)
      return next
    })
  }, [])
  const [browserVisible, setBrowserVisible] = useState(false)
  const [minimizedWindows, setMinimizedWindows] = useState<MinimizedWindow[]>([])
  const [windowsFloating, setWindowsFloating] = useState(false)
  const savedSites = useBrowserSavedSitesController()
  // A shortcut or menu action main refused; shown under the title bar until dismissed.
  const [shellError, setShellError] = useState<string | null>(null)
  const report = useCallback((fallback: string) => (error: unknown) => setShellError(errorMessage(error, fallback)), [])
  const updateAppearance = useCallback((patch: Partial<AppearanceSettings>): void => {
    setAppearance((current) => {
      const next = normalizeAppearanceSettings({ ...current, ...patch })
      persistAppearanceSettings(window.localStorage, next)
      return next
    })
  }, [])
  const changeChatZoom = useCallback((command: ChatZoomCommand): void => {
    setAppearance((current) => {
      const next = { ...current, chatZoom: applyChatZoomCommand(current.chatZoom, command) }
      persistAppearanceSettings(window.localStorage, next)
      return next
    })
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const command = chatZoomCommandForKey(event)
      if (command) {
        event.preventDefault()
        changeChatZoom(command)
        return
      }
      const shortcut = appShortcutForKey(event)
      if (shortcut === 'settings') {
        event.preventDefault()
        setSettingsOpen(true)
      } else if (shortcut === 'overview') {
        event.preventDefault()
        spacesRef.current?.toggleOverview()
      } else if (shortcut === 'tile-windows') {
        event.preventDefault()
        workspaceRef.current?.tileWindows()
      } else if (shortcut === 'notepad') {
        event.preventDefault()
        workspaceRef.current?.openNotepad().catch(report('Could not open the notepad'))
      } else if (shortcut === 'tools' || shortcut === 'trace') {
        event.preventDefault()
        workspaceRef.current?.openView(shortcut)
      } else if (shortcut === 'reload') {
        event.preventDefault()
        window.location.reload()
      } else if (shortcut === 'toggle-devtools') {
        event.preventDefault()
        window.closedai.window.toggleDevTools().catch(report('Could not open developer tools'))
      } else if (shortcut === 'history') {
        event.preventDefault()
        focusSearch()
      } else if (shortcut === 'new-chat') {
        event.preventDefault()
        history.newChat()
      } else if (shortcut === 'close-tab') {
        event.preventDefault()
        workspaceRef.current?.closeFocused().catch(report('Could not close the chat'))
      } else if (shortcut === 'close-window') {
        event.preventDefault()
        window.closedai.window.close().catch(report('Could not close the window'))
      } else if (shortcut === 'toggle-fullscreen') {
        event.preventDefault()
        window.closedai.window.toggleFullscreen().catch(report('Could not toggle fullscreen'))
      } else if (shortcut === 'pause-task') {
        const dialogs = dialogsRef.current
        const hasOpenModal = dialogs.settingsOpen || Boolean(dialogs.renamingChat)
        const pauses = escapePausesTask({
          overlayOpen: hasOpenModal || Boolean(document.querySelector(
            '[data-spaces-overview], [role="dialog"], [role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper], .radix-dropdown-menu-content'
          )),
          activeElement: document.activeElement,
          soloActive: Boolean(document.querySelector('.chat-layout-tile[data-solo="true"]')),
          layoutBusy: document.body.hasAttribute('data-layout-resize') || Boolean(document.querySelector('[data-layout-drag]'))
        })
        if (!pauses) return

        const currentChat = chatRef.current
        const runningPaneId = targetRunningPaneId(
          currentChat.selectedPaneId,
          currentChat.state.activeTurnId,
          currentChat.snapshot.panes
        )
        // No stopPropagation: bubble-phase owners (solo exit, drag cancel) already declined above,
        // and the pause request must not silence a listener the decision did not know about.
        if (runningPaneId) {
          event.preventDefault()
          const pause = runningPaneId === currentChat.selectedPaneId
            ? currentChat.interrupt()
            : currentChat.interruptPane(runningPaneId)
          pause.catch(report('Could not pause the task'))
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [changeChatZoom, history.newChat, focusSearch, report])

  // Syntax grammars cost the same whenever they are compiled; paid here they are off every
  // chat switch, because the first transcript that holds a code block already finds them ready.
  useEffect(() => {
    const warm = (): void => { void import('../components/ui/code-highlighter.js').then((module) => module.warmCodeHighlighter()) }
    const idle = window.requestIdleCallback?.(warm, { timeout: 4000 })
    const timer = idle === undefined ? window.setTimeout(warm, 1500) : null
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  const selectedRow = chat.chats.find((row) => row.paneId === chat.selectedPaneId)
  // A detached window belongs to one project; main closes it when another project is selected.
  const windowCwd = appWindow().cwd
  // The dock belongs to the main window, beside the spaces it navigates; Keep visible gives it a row.
  const dockPinned = appWindow().main && dockPrefs.keepVisible && Boolean(chat.selectedPaneId)
  const projectElsewhere = windowCwd !== null && (chat.workspace?.cwd ?? chat.state.cwd) !== windowCwd
  const ready = chat.state.connection.state === 'ready'
  const running = chat.state.activeTurnId !== null
  // Compaction is a manual step only where the provider does not rotate seamlessly; elsewhere
  // the row stays visible but disabled so the menu reads the same in every chat.
  const compactEnabled = providerSupportsContextShrink(chat.state.provider, chat.preferences?.chatSeamlessRotation)
    && ready && !running && chat.state.items.some((item) => item.type === 'user')
  const activeLocalUser = onboarding.settings.activeUserId
    ? onboarding.settings.users.find((user) => user.id === onboarding.settings.activeUserId) ?? null
    : null
  const endLocalSession = useCallback((): void => {
    setSettingsOpen(false)
    setWallpaperOpen(false)
    onboarding.signOut()
  }, [onboarding.signOut])
  const menuAction = useCallback((action: Exclude<MenuAction, 'search-chats'>): void => {
    switch (action) {
      case 'new-chat': history.newChat(); break
      case 'settings': setSettingsTab('appearance'); setSettingsOpen(true); break
      case 'sign-out':
        endLocalSession()
        break
      // Trace, Agents, History, Tools and Saved sites are view tabs, not dialogs.
      case 'history': workspaceRef.current?.toggleView('history').catch(report('Could not open chat history')); break
      case 'toggle-browser': workspaceRef.current?.toggleBrowser(); break
      case 'overview': spacesRef.current?.toggleOverview(); break
      case 'tile-windows': workspaceRef.current?.tileWindows(); break
      case 'layout': workspaceRef.current?.openLayoutPresets(); break
      case 'toggle-fullscreen': window.closedai.window.toggleFullscreen().catch(report('Could not toggle fullscreen')); break
      case 'close-tab': workspaceRef.current?.closeFocused().catch(report('Could not close the chat')); break
      case 'close-window': window.closedai.window.close().catch(report('Could not close the window')); break
      case 'agents': case 'tools': case 'trace': case 'saved-sites': workspaceRef.current?.openView(action); break
      case 'notepad': workspaceRef.current?.openNotepad().catch(report('Could not open the notepad')); break
      case 'compact': chatRef.current.compactConversation().catch(report('Could not compact the conversation')); break
      case 'stop-turn': chatRef.current.interrupt().catch(report('Could not pause the task')); break
      case 'reload': window.location.reload(); break
      case 'devtools': window.closedai.window.toggleDevTools().catch(report('Could not open developer tools')); break
    }
  }, [endLocalSession, history.newChat, report])

  // Everything the title bar and dock receive is keyed on the few fields that change at turn
  // boundaries, never on the controller itself: it is rebuilt for every streamed chunk, and the
  // dock, its start panel and the usage rail must not reconcile at that rate.
  const selectedTitle = selectedRow?.title ?? null
  const selectedBusy = selectedRow?.running ?? false
  const applyPreset = useCallback((preset: LayoutPreset) => workspaceRef.current?.applyPreset(preset), [])
  const applicationMenu = useMemo<TitlebarMenuProps>(() => ({
    chatZoom: appearance.chatZoom,
    selectedChatTitle: selectedTitle,
    compactEnabled,
    stopEnabled: running,
    onChatZoomChange: changeChatZoom,
    onAction: menuAction,
    onSearchChats: focusSearch,
    layoutEnabled: Boolean(chat.selectedPaneId),
    tileEnabled: windowsFloating,
    onApplyLayoutPreset: applyPreset
  }), [appearance.chatZoom, selectedTitle, compactEnabled, running, changeChatZoom, menuAction, focusSearch, chat.selectedPaneId, windowsFloating, applyPreset])
  const sendToChat = useCallback((chatId: string, text: string) => workspaceRef.current?.sendToChat(chatId, text), [])
  const startAgent = useCallback(async (chatId: string, options: AgentRunStartOptions) => {
    await workspaceRef.current?.startAgent(chatId, options)
  }, [])
  const startServices = useMemo<StartServices>(() => ({
    chats: chat.chats,
    history,
    selectedPaneId: chat.selectedPaneId,
    selectedBusy,
    listChats: chat.listChats,
    archiveChat: history.deleteRow,
    openChat: openHistoryChat,
    sendToChat,
    startAgent,
    settings: { appearance, onAppearanceChange: updateAppearance, backdropStatus, onOpenWallpaper: openWallpaper }
  }), [chat.chats, history, chat.selectedPaneId, selectedBusy, chat.listChats, openHistoryChat, sendToChat, startAgent, appearance, updateAppearance, backdropStatus, openWallpaper])
  const onDockLaunch = useCallback<AppDockProps['onLaunch']>((id) => {
    if (id === 'chats') workspaceRef.current?.toggleView('history').catch(report('Could not open chat history'))
    else if (id === 'browser') workspaceRef.current?.toggleBrowser()
    else if (id === 'note') workspaceRef.current?.openNotepad().catch(report('Could not open the notepad'))
    else workspaceRef.current?.openView('agents')
  }, [report])
  const onOpenSite = useCallback((url: string) => { workspaceRef.current?.openSite(url).catch(report('Could not open the saved site')) }, [report])
  const onAllSavedSites = useCallback(() => workspaceRef.current?.openView('saved-sites'), [])
  const onRestoreWindow = useCallback((id: string) => workspaceRef.current?.restoreWindow(id), [])
  const onTileWindows = useCallback(() => workspaceRef.current?.tileWindows(), [])
  const onOpenLayouts = useCallback(() => workspaceRef.current?.openLayoutPresets(), [])
  const onOpenChat = useCallback((paneId: string) => { void workspaceRef.current?.activateChat(paneId) }, [])
  const renderDock = useCallback((nav: SpacesDockNav) => <AppDock menu={applicationMenu} nav={nav} chats={chat.chats} chatTitle={selectedTitle}
    browserVisible={browserVisible} prefs={dockPrefs} onPrefsChange={updateDockPrefs}
    onLaunch={onDockLaunch} onOpenSite={onOpenSite} onAllSavedSites={onAllSavedSites}
    minimized={minimizedWindows} onRestoreWindow={onRestoreWindow}
    canTile={windowsFloating} onTileWindows={onTileWindows}
    onApplyPreset={applyPreset} onOpenLayouts={onOpenLayouts} onOpenChat={onOpenChat}
    startServices={startServices} />,
  [applicationMenu, chat.chats, selectedTitle, browserVisible, dockPrefs, updateDockPrefs, onDockLaunch, onOpenSite, onAllSavedSites,
    minimizedWindows, onRestoreWindow, windowsFloating, onTileWindows, applyPreset, onOpenLayouts, onOpenChat, startServices])
  const onRenameChat = useCallback((id: string, title: string) => setRenamingChat({ id, title }), [])
  const onBackdropChange = useCallback((mode: AppearanceSettings['backdrop']) => updateAppearance({ backdrop: mode }), [updateAppearance])
  const savedSitesError = useMemo(() => report('Could not update saved sites'), [report])
  const notepadError = useMemo(() => report('Could not update the note'), [report])
  // The main window's menus live in the dock; the title bar only falls back to them when startup
  // failed and no dock exists. While starting there is no pane yet either, so gating on the pane
  // alone flashed File / View / Agent / Developer on every launch.
  const startupStalled = chat.state.connection.state !== 'starting' && chat.state.connection.state !== 'ready'
  useMenuRunBridge(applicationMenu, chat.selectedPaneId, () => workspaceRef.current?.focusedCloseTarget() ?? chat.selectedPaneId)

  return (
    <div className="shell" data-ui-surface="shell">
      <header className="shell-titlebar" aria-label="Window title bar">
        <TitlebarRail search={searchTools} />
        <div className="titlebar-start">
          {activeLocalUser && onboarding.settings.sessionUnlocked && (
            <SessionAccountMenu
              user={activeLocalUser}
              onSignOut={endLocalSession}
              onConnectProviders={onboarding.reopenProviderSetup}
            />
          )}
          {(!appWindow().main || (!chat.selectedPaneId && startupStalled)) && <TitlebarMenu {...applicationMenu} />}
        </div>
        <div ref={setSearchTools} className="titlebar-search-tools">
          <HeaderChatSearch chats={chat.chats} controller={history} inputRef={searchRef} />
        </div>
        <AppWindowControls />
      </header>
      <div className="shell-titlebar-divider" aria-hidden="true" />
      {shellError && (
        <div className="shell-alert" role="alert">
          <span>{shellError}</span>
          <button type="button" className="shell-alert-dismiss" data-ui="shell.alert-dismiss" onClick={() => setShellError(null)}>Dismiss</button>
        </div>
      )}
      <div className="workspace" data-mode="chat" style={dockPinned ? { paddingBottom: DOCK_RESERVE } : undefined}>
        {!chat.selectedPaneId && <AppStartup connection={chat.state.connection} onRetry={chat.retryStartup} />}
        {chat.selectedPaneId && !projectElsewhere && <SpacesStage ref={spacesRef} enabled={appWindow().main}
          workspace={chat.workspace ?? { cwd: chat.state.cwd, projectPath: null }} chats={chat.chats}
          selectedPaneId={chat.selectedPaneId}
          dock={renderDock}>
          {({ browserHeld, spaceId }) => <DesktopWorkspace
            key={spaceId ?? chat.workspace?.cwd ?? chat.state.cwd}
            spaceId={spaceId}
            ref={workspaceRef}
            chat={chat}
            savedSites={savedSites}
            reviewQueue={history.reviewQueue}
            appearance={appearance}
            toolsPreset={toolsPreset}
            browserHeld={browserHeld}
            onRenameChat={onRenameChat}
            onSavedSitesError={savedSitesError}
            onNotepadError={notepadError}
            onBrowserVisibleChange={setBrowserVisible}
            onMinimizedChange={setMinimizedWindows}
            onFloatingChange={setWindowsFloating}
            onBackdropChange={onBackdropChange}
            onOpenWallpaper={openWallpaper}
            archiveChat={history.deleteRow}
          />}
        </SpacesStage>}
      </div>
      <ChatRenameDialog
        open={Boolean(renamingChat)}
        chatId={renamingChat?.id ?? ''}
        currentTitle={renamingChat?.title ?? ''}
        onClose={() => setRenamingChat(null)}
        onSave={async (id, title) => {
          await chat.sidebar.renameChat(id, title)
        }}
      />
      {settingsOpen && <Suspense fallback={null}>
        <SettingsDialog
          open={settingsOpen}
          tab={settingsTab}
          onTabChange={setSettingsTab}
          onOpenChange={setSettingsOpen}
          appearance={appearance}
          onAppearanceChange={updateAppearance}
          backdropStatus={backdropStatus}
          onOpenWallpaper={openWallpaper}
        />
      </Suspense>}
      {wallpaperOpen && <Suspense fallback={null}>
        <WallpaperDialog
          onOpenChange={setWallpaperOpen}
          backdrop={appearance.backdrop}
          status={backdropStatus}
          onBackdropChange={(mode) => updateAppearance({ backdrop: mode })}
        />
      </Suspense>}
      {onboarding.showSessionGate && (
        <SessionGate
          users={onboarding.settings.users}
          keepSignedIn={onboarding.keepSignedIn}
          onKeepSignedInChange={onboarding.setKeepSignedIn}
          onSignIn={onboarding.signIn}
          onSetProfilePassword={onboarding.setProfilePassword}
          onCreateAccount={onboarding.createAccount}
          onDeleteAccount={onboarding.deleteAccount}
        />
      )}
      {onboarding.switchingProfile && (
        <ProfileSwitchCover user={activeLocalUser} />
      )}
      <ProviderSetupModal
        open={onboarding.showProviderSetup}
        connectedProviders={onboarding.connectedProviders}
        onSignInProvider={(provider) => window.closedai.chat.providerSignIn(provider)}
        onMarkConnected={onboarding.markProviderConnected}
        onClearConnected={onboarding.clearProviderConnected}
        onContinue={onboarding.completeProviderSetup}
        onSkip={onboarding.skipProviderSetup}
      />
    </div>
  )
}
