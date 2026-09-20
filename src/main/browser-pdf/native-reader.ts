import { WebContentsView, type WebContents } from 'electron'
import { withCaptureDocument } from '../browser-capture-guard.js'
import { PDF_VIEWER_URL, type NativePdfText } from './accessibility-text.js'
import { nativePdfReadScript } from './reader-script.js'

/** Read the PDF Chromium already loaded, including authenticated/ephemeral URLs.
 * No document refetch, second PDF parser, OCR, selection, or global accessibility toggle.
 */
export async function readNativePdf(
  target: WebContents,
  page: number,
  maxChars: number,
  signal?: AbortSignal
): Promise<NativePdfText | null> {
  const viewer = target.mainFrame.framesInSubtree.find(frame => frame.url === PDF_VIEWER_URL)
  if (!viewer) return null
  return withCaptureDocument(target, async () => {
    if (await target.executeJavaScript('document.visibilityState') !== 'visible') {
      throw new Error('Native PDF reading needs a visible tab. Select this PDF with closedai_app.command browser_tab select, then retry read_page.')
    }
    const frame = target.mainFrame
    const helper = new WebContentsView({ webPreferences: {
      session: target.session, sandbox: true, contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false
    } })
    const contents = helper.webContents
    const deadline = AbortSignal.timeout(9_000)
    const stop = signal ? AbortSignal.any([signal, deadline]) : deadline
    const dispose = () => { if (!contents.isDestroyed()) contents.close() }
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    stop.addEventListener('abort', dispose, { once: true })
    try {
      stop.throwIfAborted()
      await contents.loadURL('chrome://accessibility/')
      const result = await contents.executeJavaScript(nativePdfReadScript(frame.processId, frame.routingId, page, maxChars)) as NativePdfText
      stop.throwIfAborted()
      if (!result || typeof result.text !== 'string' || typeof result.available !== 'boolean') {
        throw new Error('Chromium returned an unsupported PDF accessibility response')
      }
      return result
    } catch (error) {
      stop.throwIfAborted()
      throw error
    } finally {
      stop.removeEventListener('abort', dispose)
      dispose()
    }
  })
}
