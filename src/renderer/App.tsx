import type { JSX } from 'react'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/inter/wght-italic.css'
import '@fontsource-variable/geist-mono/wght.css'
import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SideDrawer } from './side-drawer/side-drawer.js'
import { DrawerToggle } from './side-drawer/drawer-toggle.js'
import { useDrawerController } from './side-drawer/drawer-controller.js'
import { AppWindowControls } from './app-window-controls.js'
import { BrowserPane } from './browser-pane.js'
import { useBrowserController } from './browser-controller.js'
import { useChatController, type ChatController } from './chat-controller.js'
import { ChatPane } from './chat-pane.js'
import {
  applyChatZoomCommand,
  chatZoomCommandForKey,
  type ChatZoomCommand
} from './chat-zoom.js'
import { appShortcutForKey } from './app-shortcuts.js'
import { TitlebarMenu } from './titlebar-menu.js'
import { WorkspaceSplit } from './workspace-split.js'
import { AppearanceSettingsDialog } from './settings/appearance-settings-dialog.js'
import {
  normalizeAppearanceSettings,
  persistAppearanceSettings,
  readAppearanceSettings,
  type AppearanceSettings
} from './settings/appearance-settings.js'
import './styles.css'

function App(): JSX.Element {
  const chat = useChatController()
  const drawer = useDrawerController(chat)
  const [appearance, setAppearance] = useState(() => readAppearanceSettings(window.localStorage))
  const [settingsOpen, setSettingsOpen] = useState(false)
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
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [changeChatZoom, toggleHistory])

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
          onChatZoomChange={changeChatZoom}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleHistory={toggleHistory}
        />
        <AppWindowControls />
      </header>
      <div className="shell-titlebar-divider" aria-hidden="true" />
      <div className="workspace" data-mode="chat" data-agents={drawer.isCollapsed ? 'closed' : 'open'}>
        <SideDrawer controller={drawer} chat={chat} />
        <DesktopWorkspace
          chat={chat}
          appearance={appearance}
          historyOpen={historyOpen}
          onHistoryOpenChange={setHistoryOpen}
        />
      </div>
      <AppearanceSettingsDialog
        open={settingsOpen}
        {...appearance}
        onOpenChange={setSettingsOpen}
        onChange={updateAppearance}
      />
    </div>
  )
}

const DesktopWorkspace = React.memo(function DesktopWorkspace({
  chat,
  appearance,
  historyOpen,
  onHistoryOpenChange
}: {
  chat: ChatController
  appearance: AppearanceSettings
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
}): JSX.Element {
  const browser = useBrowserController('browser')
  return (
    <WorkspaceSplit
      chat={
        <ChatPane
          controller={chat}
          zoom={appearance.chatZoom}
          fontSize={appearance.chatFontSize}
          composerFontSize={appearance.composerFontSize}
          historyOpen={historyOpen}
          onHistoryOpenChange={onHistoryOpenChange}
        />
      }
      workspace={
        <div className="workspace-right" data-mode="browser" data-with-browser="yes" data-refs="no">
          <div className="workspace-surface workspace-surface-browser">
            <BrowserPane controller={browser} />
          </div>
        </div>
      }
    />
  )
})

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
