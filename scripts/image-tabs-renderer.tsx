// Renderer fixture for the focused Electron image-tab integration check.
import { createRoot } from 'react-dom/client'
import { BrowserPane } from '../src/renderer/browser-pane.js'
import { useBrowserController } from '../src/renderer/browser-controller.js'
import { LocalFileMarkdown } from '../src/renderer/local-file-markdown.js'
import { TranscriptAttachments } from '../src/renderer/composer-attachments.js'

function Fixture() {
  const controller = useBrowserController('image-tab-check')
  const path = new URLSearchParams(location.search).get('image')!
  return <>
    <aside><h2>Image tab check</h2><LocalFileMarkdown>{`[Open image](${path})`}</LocalFileMarkdown>
      <TranscriptAttachments attachments={[{ id: 'fixture-attachment', kind: 'image', name: 'Attached image', path }]} />
    </aside>
    <BrowserPane controller={controller} />
  </>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
