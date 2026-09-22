import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../App.js'
import { AppErrorBoundary, watchUnhandledRejections } from '../app-error-boundary.js'
import { saveLayout } from '../chat-layout/layout-tree.js'
import { createPreviewBridge } from './bridge.js'
import { parseScenario, PREVIEW_CWD, sampleLayout } from './fixtures.js'
import { ProjectShellPreview } from './project-shell.js'
import { createPreviewStorage } from './storage.js'
import '../styles/preview/project-canvas.css'
import '../styles/preview/project-shell.css'
import '../styles/preview/shell.css'

if (window.closedai) throw new Error('The UI preview must not replace a real Electron bridge.')
// Real components use localStorage. Keep their preferences/drafts private to this document,
// so other model tabs cannot alter a scenario between seeding it and React mounting it.
const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')!
Object.defineProperty(window, 'localStorage', { configurable: true, value: createPreviewStorage() })
const scenario = parseScenario(new URLSearchParams(location.search).get('scenario'))
document.title = `ClosedAI UI preview — ${scenario}`
document.documentElement.dataset.previewState = 'loading'
saveLayout(localStorage, PREVIEW_CWD, sampleLayout(scenario))

const notice = new EventTarget()
let latestNotice = ''
const report = (message: string) => { latestNotice = message; notice.dispatchEvent(new Event('change')) }
const surface = document.createElement('div')
surface.className = 'preview-native-surface'
surface.textContent = 'Browser surface placeholder — native web content requires Electron'
surface.hidden = true
document.body.append(surface)
const bridge = createPreviewBridge(scenario, report, (bounds) => {
  surface.hidden = bounds.visible === false || !!bounds.occluded || bounds.width < 1 || bounds.height < 1
  Object.assign(surface.style, { left: `${bounds.x}px`, top: `${bounds.y}px`,
    width: `${bounds.width}px`, height: `${bounds.height}px` })
})
window.closedai = bridge.api
const errors: string[] = []
function recordError(value: unknown) {
  errors.push(String(value))
  document.documentElement.dataset.previewState = 'error'
  report(`Preview error: ${String(value)}`)
}
// Chromium reports a ResizeObserver callback that resized an observed box as a window error
// event. It is a one-frame relayout notice, not an exception, so it is not a preview failure.
const onError = (event: ErrorEvent) => {
  if (event.message.startsWith('ResizeObserver loop')) return
  recordError(event.message)
}
const preventDrop = (event: Event) => event.preventDefault()
window.addEventListener('error', onError)
const stopWatchingRejections = watchUnhandledRejections(recordError)
window.addEventListener('dragover', preventDrop)
window.addEventListener('drop', preventDrop)
const previewFallback = () => <p role="alert">The preview failed to render. Check the browser console.</p>

function Preview() {
  const [message, setMessage] = useState(latestNotice)
  useEffect(() => {
    const changed = () => setMessage(latestNotice)
    notice.addEventListener('change', changed)
    // App effects subscribe before streaming starts; cleanup also covers StrictMode's replay.
    bridge.start()
    const ready = () => {
      const count = [...document.querySelectorAll('[data-ui="composer.input"]')]
        .filter((element) => element.getBoundingClientRect().width > 0).length
      const expected = scenario === 'split' ? 2 : 1
      const projectReady = scenario === 'project' && document.querySelector('[data-preview-project-shell]')
      const appReady = scenario !== 'project' && document.querySelector('[data-ui-key="preview-chat-1"]')
        && (scenario !== 'settings' || document.querySelector('[role="dialog"]'))
      if (!errors.length && count === expected && (projectReady || appReady)) {
        document.documentElement.dataset.previewState = 'ready'
        observer.disconnect()
      }
    }
    const observer = new MutationObserver(ready)
    observer.observe(document.getElementById('root')!, { childList: true, subtree: true, attributes: true })
    ready()
    return () => { notice.removeEventListener('change', changed); observer.disconnect() }
  }, [])
  return <>
    <AppErrorBoundary fallback={previewFallback} onError={(error) => recordError(error.message)}>
      {scenario === 'project' ? <ProjectShellPreview /> : <App initialSettingsOpen={scenario === 'settings'} />}
    </AppErrorBoundary>
    {message && <aside className="preview-notice" aria-label="UI preview notice">
      <span role="status">{message}</span>
      <button type="button" data-ui="preview.dismiss-notice" aria-label="Dismiss preview notice"
        onClick={() => { latestNotice = ''; setMessage('') }}>Dismiss</button>
    </aside>}
  </>
}

const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><Preview /></StrictMode>)
// App/component HMR preserves state. Replacing the preview infrastructure resets it cleanly.
import.meta.hot?.accept(() => location.reload())
import.meta.hot?.dispose(() => {
  bridge.dispose()
  root.unmount()
  surface.remove()
  window.removeEventListener('error', onError)
  stopWatchingRejections()
  window.removeEventListener('dragover', preventDrop)
  window.removeEventListener('drop', preventDrop)
  Reflect.deleteProperty(window, 'closedai')
  Object.defineProperty(window, 'localStorage', storageDescriptor)
})
