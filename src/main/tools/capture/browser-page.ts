import { describeReadiness } from '../../browser-page-ready.js'
import type { ToolAction } from '../action-tool.js'
import { failureResult, stringArg } from '../tool.js'
import { MAX_WAIT_MS, readinessFrom, readinessProperties, tabIdField } from '../browser/fields.js'
import type { UiCaptureHostProvider } from './host.js'
import { requireCaptureHost } from './host.js'
import { describeMissingTab } from '../../../shared/browser-tabs.js'
import { imageResult } from './result.js'
import type { ScreenshotStore } from './screenshot-store.js'

export function browserPageAction(capture: UiCaptureHostProvider, store: ScreenshotStore): ToolAction {
  return {
    action: 'browser_page',
    description:
      'Capture one browser page without app chrome (active tab unless tab_id). Waits for load state and optional selector/text; fails if unmet or the main page navigates/loses its renderer during capture. Returns a scaled JPEG. DOM, animation, and subframes are not frozen; this is not an atomic DOM/pixel snapshot.',
    inputSchema: {
      type: 'object',
      properties: { tab_id: tabIdField, ...readinessProperties },
      additionalProperties: false
    },
    timeoutMs: MAX_WAIT_MS + 5_000,
    async run(input, context) {
      const tabId = stringArg(input, 'tab_id')
      const readiness = readinessFrom(input)
      const host = requireCaptureHost(capture)
      const result = await host.captureBrowserPage(tabId, readiness)
      if (!result) return failureResult(describeMissingTab(tabId, host.listTabs()))
      const ready = describeReadiness(readiness, result.ready)
      const summary = `${result.title ? `Page: ${result.title}\n` : ''}URL: ${result.url}\nTab: ${result.tabId}\n${ready}`
      if (!result.image) return failureResult(`${summary}${result.error ? `\nCapture failed: ${result.error}` : ''}`)
      return imageResult(summary, result.image, 'browser_page', store, context.callId)
    }
  }
}
