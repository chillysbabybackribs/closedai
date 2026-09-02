import type { JSX } from 'react'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/inter/wght-italic.css'
import '@fontsource-variable/geist-mono/wght.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AppWindowControls } from './app-window-controls.js'
import { BrowserPane } from './browser-pane.js'
import { useBrowserController } from './browser-controller.js'
import { ChatPane } from './chat-pane.js'
import { WorkspaceSplit } from './workspace-split.js'
import './styles.css'

function App(): JSX.Element {
  const browser = useBrowserController('browser', true)
  return (
    <div className="shell" data-ui-surface="shell">
      <header className="shell-titlebar" aria-label="Window title bar">
        <AppWindowControls />
      </header>
      <div className="shell-titlebar-divider" aria-hidden="true" />
      <div className="workspace" data-mode="browser" data-agents="closed">
        <WorkspaceSplit
          chat={<ChatPane />}
          workspace={
            <div className="workspace-right" data-mode="browser" data-with-browser="yes" data-refs="no">
              {/* The browser stays mounted: its native-view host ref and ResizeObserver own the page bounds. */}
              <div className="workspace-surface workspace-surface-browser">
                <BrowserPane controller={browser} />
              </div>
            </div>
          }
        />
      </div>
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
