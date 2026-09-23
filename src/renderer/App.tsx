import type { JSX } from 'react'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/inter/wght-italic.css'
import '@fontsource-variable/geist-mono/wght.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { HeaderChatSearch } from './chat-history/header-search.js'
import { useHistoryController } from './chat-history/history-controller.js'
import { AppWindowControls } from './app-window-controls.js'
import { useChatController } from './chat-controller.js'
import {
  applyChatZoomCommand,
  chatZoomCommandForKey,
  type ChatZoomCommand
} from './chat-zoom.js'
import { appShortcutForKey, escapePausesTask, targetRunningPaneId } from './app-shortcuts.js'
import { AppStartup } from './app-startup.js'
import { errorMessage } from './error-message.js'
import { TitlebarMenu, type MenuAction } from './titlebar-menu.js'
import { DesktopWorkspace, type ChatLayoutHandle } from './chat-layout/desktop-workspace.js'
import type { ChatPaneDialog } from './chat-pane.js'
import { ChatRenameDialog } from './chat-rename-dialog.js'
import { SettingsDialog, type SettingsTab } from './settings/settings-dialog.js'
import { useToolsPreset } from './tools/use-tools-preset.js'
import { BrowserGlobeIcon } from './browser-globe-icon.js'
import { useBrowserSavedSitesController } from './browser-saved-sites-controller.js'
import { BrowserSavedSitesShelf } from './browser-saved-sites-shelf.js'
import {
  normalizeAppearanceSettings,
  persistAppearanceSettings,
  readAppearanceSettings,
  type AppearanceSettings
} from './settings/appearance-settings.js'
import './styles.css'

export function App({ initialSettingsOpen = false }: { initialSettingsOpen?: boolean }): JSX.Element {
  const chat = useChatController()
  const chatRef = useRef(chat)
  chatRef.current = chat
  const workspaceRef = useRef<ChatLayoutHandle>(null)
  const openHistoryChat = useCallback(async (chatId: string) => {
    await (workspaceRef.current?.activateChat(chatId) ?? chatRef.current.openChat(chatId))
  }, [])
  const history = useHistoryController(chat.sidebar, openHistoryChat)
  const searchRef = useRef<HTMLInputElement>(null)
  const focusSearch = useCallback(() => { searchRef.current?.focus(); searchRef.current?.select() }, [])
  const [appearance, setAppearance] = useState(() => readAppearanceSettings(window.localStorage))
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance')
  const [renamingChat, setRenamingChat] = useState<{ id: string; title: string } | null>(null)
  const [paneDialog, setPaneDialog] = useState<ChatPaneDialog | null>(null)
  const dialogsRef = useRef({ settingsOpen, renamingChat, paneDialog })
  dialogsRef.current = { settingsOpen, renamingChat, paneDialog }
  const toolsPreset = useToolsPreset()
  const [browserVisible, setBrowserVisible] = useState(false)
  const savedSites = useBrowserSavedSitesController()
  // A shortcut or menu action main refused; shown under the title bar until dismissed.
  const [shellError, setShellError] = useState<string | null>(null)
  const report = useCallback((fallback: string) => (error: unknown) => setShellError(errorMessage(error, fallback)), [])
  // The File menu retains the history management panel; Ctrl+H focuses header search.
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyOpenRef = useRef(historyOpen)
  historyOpenRef.current = historyOpen
  const toggleHistory = useCallback(() => setHistoryOpen((open) => !open), [])
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
      } else if (shortcut === 'tools' || shortcut === 'trace') {
        event.preventDefault()
        if (chatRef.current.selectedPaneId) setPaneDialog(shortcut)
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
        const hasOpenModal = dialogs.settingsOpen ||
          Boolean(dialogs.renamingChat) || Boolean(dialogs.paneDialog)
        const pauses = escapePausesTask({
          overlayOpen: hasOpenModal || Boolean(document.querySelector(
            '[role="dialog"], [role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper], .radix-dropdown-menu-content'
          )),
          activeElement: document.activeElement,
          soloActive: Boolean(document.querySelector('.chat-layout-tile[data-solo="true"]')),
          layoutBusy: document.body.hasAttribute('data-layout-resize') || Boolean(document.querySelector('[data-layout-drag]'))
        })
        if (!pauses) return

        if (historyOpenRef.current) {
          event.preventDefault()
          setHistoryOpen(false)
          return
        }

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
  const ready = chat.state.connection.state === 'ready'
  const running = chat.state.activeTurnId !== null
  // Compaction is a manual step only where the provider does not rotate seamlessly; elsewhere
  // the row stays visible but disabled so the menu reads the same in every chat.
  const compactEnabled = chat.state.provider === 'antigravity' && chat.preferences?.chatSeamlessRotation !== true
    && ready && !running && chat.state.items.some((item) => item.type === 'user')
  const menuAction = useCallback((action: Exclude<MenuAction, 'search-chats'>): void => {
    switch (action) {
      case 'new-chat': history.newChat(); break
      case 'settings': setSettingsTab('appearance'); setSettingsOpen(true); break
      case 'history': toggleHistory(); break
      case 'toggle-browser': workspaceRef.current?.toggleBrowser(); break
      case 'saved-sites': savedSites.toggle(); break
      case 'layout': workspaceRef.current?.openLayoutPresets(); break
      case 'toggle-fullscreen': window.closedai.window.toggleFullscreen().catch(report('Could not toggle fullscreen')); break
      case 'close-tab': workspaceRef.current?.closeFocused().catch(report('Could not close the chat')); break
      case 'close-window': window.closedai.window.close().catch(report('Could not close the window')); break
      case 'agents': case 'tools': case 'trace': setPaneDialog(action); break
      case 'compact': chatRef.current.compactConversation().catch(report('Could not compact the conversation')); break
      case 'stop-turn': chatRef.current.interrupt().catch(report('Could not pause the task')); break
      case 'reload': window.location.reload(); break
      case 'devtools': window.closedai.window.toggleDevTools().catch(report('Could not open developer tools')); break
    }
  }, [history.newChat, toggleHistory, savedSites.toggle, report])

  return (
    <div className="shell" data-ui-surface="shell">
      <header className="shell-titlebar" aria-label="Window title bar">
        <TitlebarMenu
          chatZoom={appearance.chatZoom}
          historyOpen={historyOpen}
          selectedChatTitle={selectedRow?.title ?? null}
          compactEnabled={compactEnabled}
          stopEnabled={running}
          onChatZoomChange={changeChatZoom}
          onAction={menuAction}
          onSearchChats={focusSearch}
          layoutEnabled={Boolean(chat.selectedPaneId)}
          onApplyLayoutPreset={(preset) => workspaceRef.current?.applyPreset(preset)}
        />
        <div className="titlebar-search-tools">
          <HeaderChatSearch chats={chat.chats} controller={history} inputRef={searchRef}
            onOpened={() => setHistoryOpen(false)} />
          <button type="button" className={`titlebar-icon-button titlebar-browser-toggle${browserVisible ? ' is-selected' : ''}`}
            data-ui="layout.browser-toggle" disabled={!chat.selectedPaneId}
            aria-pressed={browserVisible} aria-label={browserVisible ? 'Hide browser' : 'Show browser'}
            title={browserVisible ? 'Hide browser' : 'Show browser'}
            onClick={() => workspaceRef.current?.toggleBrowser()}>
            <BrowserGlobeIcon size={24} />
          </button>
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
      <div className="workspace" data-mode="chat">
        {!chat.selectedPaneId && <AppStartup connection={chat.state.connection} onRetry={chat.retryStartup} />}
        {chat.selectedPaneId && <DesktopWorkspace
          key={chat.workspace?.cwd ?? chat.state.cwd}
          ref={workspaceRef}
          onBrowserVisibilityChange={setBrowserVisible}
          chat={chat}
          savedSites={savedSites}
          reviewQueue={history.reviewQueue}
          appearance={appearance}
          historyOpen={historyOpen}
          onHistoryOpenChange={setHistoryOpen}
          dialog={paneDialog}
          onDialogChange={setPaneDialog}
          toolsPreset={toolsPreset}
          onRenameChat={(id, title) => setRenamingChat({ id, title })}
          archiveChat={history.deleteRow}
        />}
      </div>
      {savedSites.isOpen && <BrowserSavedSitesShelf controller={savedSites} onError={report('Could not update saved sites')}
        onOpenSite={(url) => {
          if (!browserVisible) workspaceRef.current?.toggleBrowser()
          return savedSites.open(url)
        }} />}
      <ChatRenameDialog
        open={Boolean(renamingChat)}
        chatId={renamingChat?.id ?? ''}
        currentTitle={renamingChat?.title ?? ''}
        onClose={() => setRenamingChat(null)}
        onSave={async (id, title) => {
          await chat.sidebar.renameChat(id, title)
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        onOpenChange={setSettingsOpen}
        appearance={appearance}
        onAppearanceChange={updateAppearance}
      />
    </div>
  )
}
