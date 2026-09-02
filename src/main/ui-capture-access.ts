import { desktopCapturer, nativeImage, type BrowserWindow, type NativeImage, type WebContents } from 'electron'
import type { BrowserService } from './browser-service.js'
import { waitForPageReady, type PageReadiness, type PageReadyResult } from './browser-page-ready.js'
import type { BrowserPageCapture, CapturedImage, ImageCrop, UiCaptureHost } from './tools/capture/index.js'

const MAX_IMAGE_WIDTH = 1_920
const MAX_IMAGE_HEIGHT = 1_440
// The model copy: a 1280-wide frame is ~700 image patches instead of ~1500 at 1920, and JPEG
// keeps the request bytes an order of magnitude below PNG. Text stays readable at this size.
const MODEL_MAX_WIDTH = 1_280
const MODEL_MAX_HEIGHT = 960
const MODEL_JPEG_QUALITY = 85
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

  async cropImage(dataUrl: string, crop: ImageCrop, zoom: number): Promise<CapturedImage | null> {
    const source = nativeImage.createFromDataURL(dataUrl)
    const size = source.getSize()
    if (source.isEmpty() || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 ||
        crop.x + crop.width > size.width || crop.y + crop.height > size.height) return null
    const cropped = source.crop(crop)
    const zoomed = fitWithin(crop.width * zoom, crop.height * zoom, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT)
    const magnified = zoomed.width > crop.width || zoomed.height > crop.height
      ? cropped.resize({ ...zoomed, quality: 'best' })
      : cropped
    return this.payload(magnified)
  }

  private payload(image: NativeImage): CapturedImage | null {
    const size = image.getSize()
    if (size.width === 0 || size.height === 0) return null
    const display = fitImage(image, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT)
    const model = fitImage(display, MODEL_MAX_WIDTH, MODEL_MAX_HEIGHT)
    const displaySize = display.getSize()
    const modelSize = model.getSize()
    return {
      dataUrl: `data:image/png;base64,${display.toPNG().toString('base64')}`,
      width: displaySize.width,
      height: displaySize.height,
      capturedAt: this.now().toISOString(),
      model: {
        dataUrl: `data:image/jpeg;base64,${model.toJPEG(MODEL_JPEG_QUALITY).toString('base64')}`,
        width: modelSize.width,
        height: modelSize.height
      }
    }
  }
}

function fitImage(image: NativeImage, maxWidth: number, maxHeight: number): NativeImage {
  const size = image.getSize()
  const fitted = fitWithin(size.width, size.height, maxWidth, maxHeight)
  return fitted.width < size.width || fitted.height < size.height
    ? image.resize({ ...fitted, quality: 'best' })
    : image
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
