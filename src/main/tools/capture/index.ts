import { defineActionTool } from '../action-tool.js'
import type { ToolNamespace } from '../tool.js'
import { appWindowAction } from './app-window.js'
import { browserPageAction } from './browser-page.js'
import { cropAction } from './crop.js'
import type { UiCaptureHostProvider } from './host.js'
import { ScreenshotStore } from './screenshot-store.js'

export type { BrowserPageCapture, CapturedImage, ImageCrop, ModelImage, UiCaptureHost, UiCaptureHostProvider } from './host.js'
export { ScreenshotStore, type ScreenshotSurface, type StoredScreenshot } from './screenshot-store.js'

/**
 * One visual-read tool; the action selects composed app state or deterministic page state.
 * `store` receives every full-resolution capture so the transcript can show it while the
 * model keeps only the scaled copy.
 */
export function captureTools(capture: UiCaptureHostProvider, store = new ScreenshotStore()): ToolNamespace {
  return {
    name: 'closedai_ui',
    description: 'Visual access to the application window and its embedded browser pages.',
    tools: [
      defineActionTool({
        name: 'capture',
        description:
          'Take and inspect screenshots when visual evidence is needed. Choose app_window for the ' +
          'whole user-visible interface, browser_page for an isolated readiness-gated page, or crop ' +
          'to enlarge a region from an earlier capture. ' +
          'Every screenshot stays in the conversation for later turns, so capture once per state you ' +
          'need to verify rather than after every small step.',
        actions: [appWindowAction(capture, store), browserPageAction(capture, store), cropAction(capture, store)]
      })
    ]
  }
}
