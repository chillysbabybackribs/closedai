import { desktopCapturer, type BrowserWindow, type NativeImage, type WebContents } from 'electron'
import type { BrowserService } from './browser-service.js'
import { waitForPageReady, type PageReadiness, type PageReadyResult } from './browser-page-ready.js'
import type { BrowserPageCapture, CapturedImage, UiCaptureHost } from './tools/capture/index.js'

const MAX_IMAGE_WIDTH = 1_920
const MAX_IMAGE_HEIGHT = 1_440
const PAINT_TIMEOUT_MS = 1_500

/** Electron implementation of the provider-neutral visual capture tool host. */
export class UiCaptureAccess implements UiCaptureHost {
  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly browser: () => BrowserService | null,
    private readonly now: () => Date = () => new Date()
  ) {}

  async captureAppWindow(): Promise<CapturedImage | null> {
    const window = this.window()
    if (!window || window.isDestroyed() || !window.isVisible() || window.isMinimized()) return null
    const sourceId = window.getMediaSourceId()
    const [width, height] = window.getSize()
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: fitWithin(width, height, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT)
    })
    const image = sources.find((source) => source.id === sourceId)?.thumbnail
    return image ? this.payload(image) : null
  }

  async captureBrowserPage(tabId: string | undefined, ready: PageReadiness): Promise<BrowserPageCapture | null> {
    const service = this.browser()
    if (!service) return null
    const tab = tabId
      ? service.tabList().find((candidate) => candidate.id === tabId)
      : service.tabList().find((candidate) => candidate.active)
    if (!tab) return null
    const release = service.leaseTabRendering(tab.id)
    if (!release) return null
    let observedReady: PageReadyResult | null = null
    try {
      const contents = service.contentsOf(tab.id)
      if (!contents) return null
      const readiness = await waitForPageReady(contents, ready)
      observedReady = readiness
      const base = { tabId: tab.id, url: readiness.url || tab.url, title: readiness.title || tab.title, ready: readiness }
      if (!readiness.reached || readiness.conditionMet === false) return { ...base, image: null }
      await settlePaint(contents)
      if (contents.isDestroyed()) return { ...base, image: null, error: 'The tab closed before capture' }
      const image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      const payload = this.payload(image)
      return payload ? { ...base, image: payload } : { ...base, image: null, error: 'The page produced an empty frame' }
    } catch (error) {
      return {
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        ready: observedReady ?? emptyReady(tab.url, tab.title),
        image: null,
        error: error instanceof Error ? error.message : String(error)
      }
    } finally {
      release()
    }
  }

  private payload(image: NativeImage): CapturedImage | null {
    const size = image.getSize()
    if (size.width === 0 || size.height === 0) return null
    const fitted = fitWithin(size.width, size.height, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT)
    const normalized = fitted.width < size.width || fitted.height < size.height
      ? image.resize({ ...fitted, quality: 'best' })
      : image
    const actual = normalized.getSize()
    return {
      dataUrl: `data:image/png;base64,${normalized.toPNG().toString('base64')}`,
      width: actual.width,
      height: actual.height,
      capturedAt: this.now().toISOString()
    }
  }
}

function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / Math.max(1, width), maxHeight / Math.max(1, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function settlePaint(contents: WebContents): Promise<void> {
  const paint = contents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    true
  ).then(() => {})
  await Promise.race([
    paint,
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, PAINT_TIMEOUT_MS)
      timer.unref?.()
    })
  ])
}

function emptyReady(url: string, title: string): PageReadyResult {
  return { readyState: 'unknown', reached: false, conditionMet: null, elapsedMs: 0, url, title }
}
