import type { JSX } from 'react'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/inter/wght-italic.css'
import '@fontsource-variable/geist-mono/wght.css'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SideDrawer } from './side-drawer/side-drawer.js'
import { DrawerToggle } from './side-drawer/drawer-toggle.js'
import { useDrawerController } from './side-drawer/drawer-controller.js'
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
import {
  normalizeAppearanceSettings,
  persistAppearanceSettings,
  readAppearanceSettings,
  type AppearanceSettings
} from './settings/appearance-settings.js'
import './styles.css'

function App(): JSX.Element {
  const chat = useChatController()
  const chatRef = useRef(chat)
  chatRef.current = chat
  const drawer = useDrawerController(chat.sidebar)
  const [appearance, setAppearance] = useState(() => readAppearanceSettings(window.localStorage))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [credentialsOpen, setCredentialsOpen] = useState(false)
  const [researchOpen, setResearchOpen] = useState(false)
  const [renamingChat, setRenamingChat] = useState<{ id: string; title: string } | null>(null)
  const [paneDialog, setPaneDialog] = useState<ChatPaneDialog | null>(null)
  const dialogsRef = useRef({ settingsOpen, credentialsOpen, researchOpen, renamingChat, paneDialog })
  dialogsRef.current = { settingsOpen, credentialsOpen, researchOpen, renamingChat, paneDialog }
  const workspaceRef = useRef<ChatLayoutHandle>(null)
  const splitSidebarChat = useCallback((chatId: string, edge: 'right' | 'bottom'): Promise<void> => {
    if (!workspaceRef.current) return Promise.reject(new Error('The workspace is still loading'))
    return workspaceRef.current.splitChat(chatId, edge)
  }, [])
  // Owned here because the title bar menu and Ctrl+H reach the panel that lives in the chat pane.
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
        toggleHistory()
      } else if (shortcut === 'new-chat') {
        event.preventDefault()
        drawer.newChat()
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
        if (active?.getAttribute('data-ui') === 'drawer.search' || active?.classList.contains('browser-omnibox-input')) {
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
  }, [changeChatZoom, drawer.newChat, toggleHistory])

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
        <DrawerToggle controller={drawer} />
        <TitlebarMenu
          chatZoom={appearance.chatZoom}
          historyOpen={historyOpen}
          drawerCollapsed={drawer.isCollapsed}
          onChatZoomChange={changeChatZoom}
          onNewChat={drawer.newChat}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenCredentials={() => setCredentialsOpen(true)}
          onOpenResearch={() => setResearchOpen(true)}
          onToggleHistory={toggleHistory}
          onToggleDrawer={drawer.toggleCollapsed}
          onToggleBrowser={() => workspaceRef.current?.toggleBrowser()}
          onToggleFullscreen={() => { void window.closedai.window.toggleFullscreen() }}
          onCloseWindow={() => { void window.closedai.window.close() }}
          onOpenPaneDialog={setPaneDialog}
        />
        <AppWindowControls />
      </header>
      <div className="shell-titlebar-divider" aria-hidden="true" />
      <div className="workspace" data-mode="chat" data-agents={drawer.isCollapsed ? 'closed' : 'open'}>
        <SideDrawer
          controller={drawer}
          chat={chat.sidebar}
          onSplitChat={splitSidebarChat}
          onRenameChat={(id, title) => setRenamingChat({ id, title })}
          onRetryChatTitle={(id) => { void chat.sidebar.retryChatTitle(id).catch(drawer.reportError) }}
        />
        {chat.selectedPaneId && <DesktopWorkspace
          key={chat.workspace?.cwd ?? chat.state.cwd}
          ref={workspaceRef}
          chat={chat}
          reviewQueue={drawer.reviewQueue}
          appearance={appearance}
          historyOpen={historyOpen}
          onHistoryOpenChange={setHistoryOpen}
          dialog={paneDialog}
          onDialogChange={setPaneDialog}
          onRenameChat={(id, title) => setRenamingChat({ id, title })}
          onRetryChatTitle={(id) => { void chat.sidebar.retryChatTitle(id).catch(drawer.reportError) }}
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

// A file dropped anywhere outside the composer would otherwise navigate this window to it —
// Chromium's default — which replaces the entire app UI and cannot be undone short of a reload.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (event) => event.preventDefault())
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
