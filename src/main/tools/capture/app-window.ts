import type { ToolAction } from '../action-tool.js'
import { failureResult, stringArg } from '../tool.js'
import type { UiCaptureHostProvider } from './host.js'
import { requireCaptureHost } from './host.js'
import type { CaptureDedup } from './dedup.js'
import { imageResult } from './result.js'
import type { ScreenshotStore } from './screenshot-store.js'

export function appWindowAction(capture: UiCaptureHostProvider, store: ScreenshotStore, dedup: CaptureDedup): ToolAction {
  return {
    action: 'app_window',
    description:
      'Capture the composed app window (chrome, chat, browser). Returns a scaled JPEG; full resolution stays in the transcript. ' +
      'Pass control (with item or match when it repeats) or selector to capture only that renderer element at full detail.',
    inputSchema: {
      type: 'object',
      properties: {
        control: { type: 'string', minLength: 1, maxLength: 80, description: 'Manifest control id from closedai_app.ui controls; crops to its box.' },
        item: { type: 'string', minLength: 1, maxLength: 200, description: 'The control\'s item when it repeats.' },
        match: { type: 'string', minLength: 1, maxLength: 200, description: 'Case-insensitive substring of the control name when the item is unknown.' },
        selector: { type: 'string', minLength: 1, maxLength: 1_000, description: 'Raw CSS selector; only when no manifest control fits.' }
      },
      additionalProperties: false
    },
    async run(input, context) {
      const target = {
        control: stringArg(input, 'control'),
        item: stringArg(input, 'item'),
        match: stringArg(input, 'match'),
        selector: stringArg(input, 'selector')
      }
      const named = target.selector ?? (target.control ? [target.control, target.item, target.match].filter(Boolean).join(' ') : null)
      if (!named && (target.item || target.match)) return failureResult('item and match need control')
      const image = await requireCaptureHost(capture).captureAppWindow(named ? target : undefined)
      if (!image) return failureResult('The application window is unavailable or could not produce a composed frame')
      if (!named) return imageResult('Surface: application window', image, 'app_window', store, context.callId, dedup, context.turnId)
      return imageResult(
        `Surface: application window\nElement: ${named}`, image, 'app_window', store, context.callId, dedup, context.turnId,
        `app_window:${named}`
      )
    }
  }
}
