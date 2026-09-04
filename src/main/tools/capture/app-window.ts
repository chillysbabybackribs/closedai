import type { ToolAction } from '../action-tool.js'
import { failureResult } from '../tool.js'
import type { UiCaptureHostProvider } from './host.js'
import { requireCaptureHost } from './host.js'
import { imageResult } from './result.js'
import type { ScreenshotStore } from './screenshot-store.js'

export function appWindowAction(capture: UiCaptureHostProvider, store: ScreenshotStore): ToolAction {
  return {
    action: 'app_window',
    description: 'Capture the composed app window (chrome, chat, browser). Returns a scaled JPEG; full resolution stays in the transcript.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    async run(_input, context) {
      const image = await requireCaptureHost(capture).captureAppWindow()
      if (!image) return failureResult('The application window is unavailable or could not produce a composed frame')
      return imageResult('Surface: application window', image, 'app_window', store, context.callId)
    }
  }
}
