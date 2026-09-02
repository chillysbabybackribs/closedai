import { defineActionTool } from '../action-tool.js'
import type { ToolNamespace } from '../tool.js'
import { appWindowAction } from './app-window.js'
import { browserPageAction } from './browser-page.js'
import type { UiCaptureHostProvider } from './host.js'

export type { BrowserPageCapture, CapturedImage, UiCaptureHost, UiCaptureHostProvider } from './host.js'

/** One visual-read tool; the action selects composed app state or deterministic page state. */
export function captureTools(capture: UiCaptureHostProvider): ToolNamespace {
  return {
    name: 'closedai_ui',
    description: 'Visual access to the application window and its embedded browser pages.',
    tools: [
      defineActionTool({
        name: 'capture',
        description:
          'Take a current screenshot when visual evidence is needed. Choose app_window for the ' +
          'whole user-visible interface; choose browser_page for an isolated, readiness-gated web page. ' +
          'The pixels are current-turn context, so inspect them now and carry forward only your conclusions.',
        actions: [appWindowAction(capture), browserPageAction(capture)]
      })
    ]
  }
}
