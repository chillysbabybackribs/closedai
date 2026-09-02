import type { PageReadiness, PageReadyResult } from '../../browser-page-ready.js'

export type ModelImage = {
  /** A data URL (image/jpeg or image/png) small enough to sit in thread history. */
  dataUrl: string
  width: number
  height: number
}

export type CapturedImage = {
  /** Full-resolution PNG shown to the user in the transcript; never sent to the model. */
  dataUrl: string
  width: number
  height: number
  capturedAt: string
  /** The bounded encoding the model receives. Image tokens scale with pixels, and the
   * app-server replays every tool image on every later turn, so this stays small. */
  model: ModelImage
}

export type BrowserPageCapture = {
  image: CapturedImage | null
  tabId: string
  url: string
  title: string
  ready: PageReadyResult
  error?: string
}

export type ImageCrop = {
  x: number
  y: number
  width: number
  height: number
}

/** Provider-neutral surface used by the capture actions; the Electron adapter lives outside tools. */
export type UiCaptureHost = {
  captureAppWindow(): Promise<CapturedImage | null>
  captureBrowserPage(tabId: string | undefined, ready: PageReadiness): Promise<BrowserPageCapture | null>
  cropImage(dataUrl: string, crop: ImageCrop, zoom: number): Promise<CapturedImage | null>
}

export type UiCaptureHostProvider = () => UiCaptureHost | null

export function requireCaptureHost(provider: UiCaptureHostProvider): UiCaptureHost {
  const host = provider()
  if (!host) throw new Error('UI capture is not available yet')
  return host
}
