import { describeReadiness } from '../../browser-page-ready.js'
import type { ToolAction } from '../action-tool.js'
import { failureResult, stringArg } from '../tool.js'
import { MAX_WAIT_MS, readinessFrom, readinessProperties, tabIdField } from '../browser/fields.js'
import type { UiCaptureHostProvider } from './host.js'
import { requireCaptureHost } from './host.js'
import { imageResult } from './result.js'

export function browserPageAction(capture: UiCaptureHostProvider): ToolAction {
  return {
    action: 'browser_page',
    description:
      'Capture only a browser page, without app chrome. The active tab is used unless tab_id is ' +
      'given. Waits deterministically for the requested load state and optional selector or text; ' +
      'if the condition is not reached, it fails instead of returning an ambiguous frame. Returns a PNG image.',
    inputSchema: {
      type: 'object',
      properties: { tab_id: tabIdField, ...readinessProperties },
      additionalProperties: false
    },
    timeoutMs: MAX_WAIT_MS + 5_000,
    async run(input) {
      const tabId = stringArg(input, 'tab_id')
      const readiness = readinessFrom(input)
      const result = await requireCaptureHost(capture).captureBrowserPage(tabId, readiness)
      if (!result) return failureResult(tabId ? `No tab with id ${tabId}` : 'No active tab')
      const ready = describeReadiness(readiness, result.ready)
      const summary = `${result.title ? `Page: ${result.title}\n` : ''}URL: ${result.url}\nTab: ${result.tabId}\n${ready}`
      if (!result.image) return failureResult(`${summary}${result.error ? `\nCapture failed: ${result.error}` : ''}`)
      return imageResult(summary, result.image)
    }
  }
}
