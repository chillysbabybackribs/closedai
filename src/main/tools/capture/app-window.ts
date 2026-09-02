import type { ToolAction } from '../action-tool.js'
import { failureResult } from '../tool.js'
import type { UiCaptureHostProvider } from './host.js'
import { requireCaptureHost } from './host.js'
import { imageResult } from './result.js'

export function appWindowAction(capture: UiCaptureHostProvider): ToolAction {
  return {
    action: 'app_window',
    description:
      'Capture the entire composed application window exactly as the user sees it, including ' +
      'the app chrome, chat, and embedded browser pane. Use this to understand layout, visual ' +
      'state, dialogs, or interactions across the whole app. Returns a PNG image.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    async run() {
      const image = await requireCaptureHost(capture).captureAppWindow()
      if (!image) return failureResult('The application window is unavailable or could not produce a composed frame')
      return imageResult('Surface: application window', image)
    }
  }
}
