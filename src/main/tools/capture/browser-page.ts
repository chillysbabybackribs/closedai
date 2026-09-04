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
      'Capture only a browser page, without app chrome. The active tab is used unless tab_id is ' +
      'given. Waits deterministically for the requested load state and optional selector or text; ' +
      'if the condition is not reached, it fails instead of returning an ambiguous frame. Returns a ' +
      'scaled JPEG; the user sees the full-resolution capture in the transcript.',
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
