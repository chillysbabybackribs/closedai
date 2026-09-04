import { describeReadiness } from '../../browser-page-ready.js'
import type { ToolAction } from '../action-tool.js'
import { failureResult, stringArg, textResult } from '../tool.js'
import { MAX_WAIT_MS, readinessFrom, readinessProperties, tabIdField } from './fields.js'
import { missingTabResult, requireBrowser, type BrowserHostProvider } from './host.js'

export function waitForAction(browser: BrowserHostProvider): ToolAction {
  return {
    action: 'wait_for',
    description: 'Wait for load state and optional selector or text; use after incomplete navigate.',
    inputSchema: {
      type: 'object',
      properties: { tab_id: tabIdField, ...readinessProperties },
      additionalProperties: false
    },
    timeoutMs: MAX_WAIT_MS + 5_000,
    async run(input) {
      const tabId = stringArg(input, 'tab_id')
      const ready = readinessFrom(input)
      const host = requireBrowser(browser)
      const result = await host.waitFor(tabId, ready)
      if (!result) return missingTabResult(host, tabId)
      const outcome = describeReadiness(ready, result)
      const text = `${result.title ? `Page: ${result.title}\n` : ''}URL: ${result.url}\n${outcome}`
      return result.reached && result.conditionMet !== false ? textResult(text) : failureResult(text)
    }
  }
}
