import type { JSX } from 'react'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/inter/wght-italic.css'
import '@fontsource-variable/geist-mono/wght.css'
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppModeToggle, type AppMode } from './app-mode-toggle.js'
import { AppWindowControls } from './app-window-controls.js'
import { BrowserPane } from './browser-pane.js'
import { useBrowserController } from './browser-controller.js'
import { ChatPane } from './chat-pane.js'
import { attentionRunCount, INITIAL_RUNS } from './operations/operations-data.js'
import { OperationsWorkspace } from './operations/operations-workspace.js'
import { WorkspaceSplit } from './workspace-split.js'
import './styles.css'

function App(): JSX.Element {
  const desktopAvailable = typeof window.closedai !== 'undefined'
  const [mode, setMode] = useState<AppMode>(() => desktopAvailable ? 'chat' : 'operations')
  const [operationsAttentionCount, setOperationsAttentionCount] = useState(() => attentionRunCount(INITIAL_RUNS))
  return (
    <div className="shell" data-ui-surface="shell" data-app-mode={mode}>
      <header className="shell-titlebar" aria-label="Window title bar">
        <AppModeToggle
          mode={mode}
          onChange={setMode}
          chatAvailable={desktopAvailable}
          operationsAttentionCount={operationsAttentionCount}
        />
        <AppWindowControls />
      </header>
      <div className="shell-titlebar-divider" aria-hidden="true" />
      <div className="workspace" data-mode={mode} data-agents="closed">
        {desktopAvailable ? (
          <DesktopWorkspace mode={mode} onAttentionCountChange={setOperationsAttentionCount} />
        ) : (
          <OperationsWorkspace onAttentionCountChange={setOperationsAttentionCount} />
        )}
      </div>
    </div>
  )
}

function DesktopWorkspace({
  mode,
  onAttentionCountChange
}: {
  mode: AppMode
  onAttentionCountChange: (count: number) => void
}): JSX.Element {
  const browser = useBrowserController('browser', true, mode === 'operations')
  return (
    <WorkspaceSplit
      chat={<ChatPane />}
      workspace={
        <div className="workspace-right" data-mode={mode === 'operations' ? 'operations' : 'browser'} data-with-browser="yes" data-refs="no">
          <div className="workspace-surface workspace-surface-browser">
            <BrowserPane controller={browser} />
          </div>
          {mode === 'operations' ? (
            <div className="workspace-surface workspace-surface-operations">
              <OperationsWorkspace onAttentionCountChange={onAttentionCountChange} />
            </div>
          ) : null}
        </div>
      }
    />
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
