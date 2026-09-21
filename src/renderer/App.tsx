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
import { appShortcutForKey, targetRunningPaneId } from './app-shortcuts.js'
import { TitlebarMenu } from './titlebar-menu.js'
import { DesktopWorkspace, type ChatLayoutHandle } from './chat-layout/desktop-workspace.js'
import type { ChatPaneDialog } from './chat-pane.js'
import { ChatRenameDialog } from './chat-rename-dialog.js'
import { AppearanceSettingsDialog } from './settings/appearance-settings-dialog.js'
import { CredentialVaultModal } from './settings/credential-vault-modal.js'
import { ResearchLibraryDialog } from './research/library-dialog.js'
import { BrowserGlobeIcon } from './browser-globe-icon.js'
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
  const history = useHistoryController(chat.sidebar)
  const searchRef = useRef<HTMLInputElement>(null)
  const focusSearch = useCallback(() => { searchRef.current?.focus(); searchRef.current?.select() }, [])
  const [appearance, setAppearance] = useState(() => readAppearanceSettings(window.localStorage))
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen)
  const [credentialsOpen, setCredentialsOpen] = useState(false)
  const [researchOpen, setResearchOpen] = useState(false)
  const [renamingChat, setRenamingChat] = useState<{ id: string; title: string } | null>(null)
  const [paneDialog, setPaneDialog] = useState<ChatPaneDialog | null>(null)
  const dialogsRef = useRef({ settingsOpen, credentialsOpen, researchOpen, renamingChat, paneDialog })
  dialogsRef.current = { settingsOpen, credentialsOpen, researchOpen, renamingChat, paneDialog }
  const workspaceRef = useRef<ChatLayoutHandle>(null)
  const [browserVisible, setBrowserVisible] = useState(false)
  // The File menu retains the history management panel; Ctrl+H focuses header search.
  const [historyOpen, setHistoryOpen] = useState(false)
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
      } else if (shortcut === 'history') {
        event.preventDefault()
        focusSearch()
      } else if (shortcut === 'new-chat') {
        event.preventDefault()
        history.newChat()
      } else if (shortcut === 'close-window') {
        event.preventDefault()
        void window.closedai.window.close()
      } else if (shortcut === 'toggle-fullscreen') {
        event.preventDefault()
        void window.closedai.window.toggleFullscreen()
      } else if (shortcut === 'pause-task') {
        const dialogs = dialogsRef.current
        const hasOpenModal = dialogs.settingsOpen || dialogs.credentialsOpen || dialogs.researchOpen ||
          Boolean(dialogs.renamingChat) || Boolean(dialogs.paneDialog)
        const hasOverlay = hasOpenModal || Boolean(document.querySelector(
          '[role="dialog"], [role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper], .radix-dropdown-menu-content'
        ))
        if (hasOverlay) return

        const active = document.activeElement as HTMLElement | null
        if (active?.getAttribute('data-ui') === 'titlebar.chat-search' || active?.classList.contains('browser-omnibox-input')) {
          return
        }

        const currentChat = chatRef.current
        const runningPaneId = targetRunningPaneId(
          currentChat.selectedPaneId,
          currentChat.state.activeTurnId,
          currentChat.snapshot.panes
        )

        if (runningPaneId) {
          event.preventDefault()
          event.stopPropagation()
          void (runningPaneId === currentChat.selectedPaneId
            ? currentChat.interrupt()
            : currentChat.interruptPane(runningPaneId))
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [changeChatZoom, history.newChat, focusSearch])

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

  return (
    <div className="shell" data-ui-surface="shell">
      <header className="shell-titlebar" aria-label="Window title bar">
        <TitlebarMenu
          chatZoom={appearance.chatZoom}
          historyOpen={historyOpen}
          onChatZoomChange={changeChatZoom}
          onNewChat={history.newChat}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenCredentials={() => setCredentialsOpen(true)}
          onOpenResearch={() => setResearchOpen(true)}
          onToggleHistory={toggleHistory}
          onSearchChats={focusSearch}
          onToggleBrowser={() => workspaceRef.current?.toggleBrowser()}
          onToggleFullscreen={() => { void window.closedai.window.toggleFullscreen() }}
          onCloseWindow={() => { void window.closedai.window.close() }}
          onOpenPaneDialog={setPaneDialog}
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
      <div className="workspace" data-mode="chat">
        {chat.selectedPaneId && <DesktopWorkspace
          key={chat.workspace?.cwd ?? chat.state.cwd}
          ref={workspaceRef}
          onBrowserVisibilityChange={setBrowserVisible}
          chat={chat}
          reviewQueue={history.reviewQueue}
          appearance={appearance}
          historyOpen={historyOpen}
          onHistoryOpenChange={setHistoryOpen}
          dialog={paneDialog}
          onDialogChange={setPaneDialog}
          onRenameChat={(id, title) => setRenamingChat({ id, title })}
          onRetryChatTitle={(id) => { void chat.sidebar.retryChatTitle(id).catch(history.reportError) }}
        />}
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
      <AppearanceSettingsDialog
        open={settingsOpen}
        {...appearance}
        onOpenChange={setSettingsOpen}
        onChange={updateAppearance}
      />
      <CredentialVaultModal
        open={credentialsOpen}
        onOpenChange={setCredentialsOpen}
      />
      <ResearchLibraryDialog open={researchOpen} onOpenChange={setResearchOpen} />
    </div>
  )
}
