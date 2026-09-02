import type { PageReadiness, PageReadyResult } from '../../browser-page-ready.js'

export type CapturedImage = {
  dataUrl: string
  width: number
  height: number
  capturedAt: string
}

export type BrowserPageCapture = {
  image: CapturedImage | null
  tabId: string
  url: string
  title: string
  ready: PageReadyResult
  error?: string
}

/** Provider-neutral surface used by the capture actions; the Electron adapter lives outside tools. */
export type UiCaptureHost = {
  captureAppWindow(): Promise<CapturedImage | null>
  captureBrowserPage(tabId: string | undefined, ready: PageReadiness): Promise<BrowserPageCapture | null>
}

export type UiCaptureHostProvider = () => UiCaptureHost | null

export function requireCaptureHost(provider: UiCaptureHostProvider): UiCaptureHost {
  const host = provider()
  if (!host) throw new Error('UI capture is not available yet')
  return host
}
