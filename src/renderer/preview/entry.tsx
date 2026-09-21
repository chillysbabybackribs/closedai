import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../App.js'
import { saveLayout } from '../chat-layout/layout-tree.js'
import { createPreviewBridge } from './bridge.js'
import { parseScenario, PREVIEW_CWD, sampleLayout, SCENARIOS } from './fixtures.js'
import { createPreviewStorage } from './storage.js'
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
let latestNotice = 'Sample data only · Native features require Electron'
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
const onError = (event: ErrorEvent) => recordError(event.message)
const onRejection = (event: PromiseRejectionEvent) => recordError(event.reason)
const preventDrop = (event: Event) => event.preventDefault()
window.addEventListener('error', onError)
window.addEventListener('unhandledrejection', onRejection)
window.addEventListener('dragover', preventDrop)
window.addEventListener('drop', preventDrop)

class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { recordError(error.message) }
  render() { return this.state.failed ? <p role="alert">The preview failed to render. Check the browser console.</p> : this.props.children }
}

function Preview() {
  const [message, setMessage] = useState(latestNotice)
  useEffect(() => {
    const changed = () => setMessage(latestNotice)
    notice.addEventListener('change', changed)
    // App effects subscribe before streaming starts; cleanup also covers StrictMode's replay.
    bridge.start()
    const ready = () => {
      const count = document.querySelectorAll('[data-ui="composer.input"]').length
      const expected = scenario === 'split' ? 2 : 1
      if (!errors.length && count === expected && document.querySelector('[data-ui-key="preview-chat-1"]')
        && (scenario !== 'settings' || document.querySelector('[role="dialog"]'))) {
        document.documentElement.dataset.previewState = 'ready'
        observer.disconnect()
      }
    }
    const observer = new MutationObserver(ready)
    observer.observe(document.getElementById('root')!, { childList: true, subtree: true })
    ready()
    return () => { notice.removeEventListener('change', changed); observer.disconnect() }
  }, [])
  return <>
    <div className="preview-toolbar">
      <strong>UI preview</strong>
      <nav aria-label="Preview scenarios">{SCENARIOS.map((name) => <a key={name}
        href={`?scenario=${name}`} data-ui="preview.scenario" data-ui-key={name}
        aria-current={scenario === name ? 'page' : undefined}>{name}</a>)}</nav>
      <span role="status">{message}</span>
    </div>
    <PreviewBoundary><App initialSettingsOpen={scenario === 'settings'} /></PreviewBoundary>
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
  window.removeEventListener('unhandledrejection', onRejection)
  window.removeEventListener('dragover', preventDrop)
  window.removeEventListener('drop', preventDrop)
  Reflect.deleteProperty(window, 'closedai')
  Object.defineProperty(window, 'localStorage', storageDescriptor)
})
