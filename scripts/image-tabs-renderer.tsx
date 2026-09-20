// Renderer fixture for the focused Electron image-tab integration check.
import { createRoot } from 'react-dom/client'
import { BrowserPane } from '../src/renderer/browser-pane.js'
import { useBrowserController } from '../src/renderer/browser-controller.js'
import { LocalFileMarkdown } from '../src/renderer/local-file-markdown.js'

function Fixture() {
  const controller = useBrowserController('image-tab-check')
  return <>
    <aside><h2>Image tab check</h2><LocalFileMarkdown>{'[Open image](/tmp/closedai-image-tab-check.png)'}</LocalFileMarkdown></aside>
    <BrowserPane controller={controller} />
  </>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
