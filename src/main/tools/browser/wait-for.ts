import { describeReadiness } from '../../browser-page-ready.js'
import type { ToolAction } from '../action-tool.js'
import { failureResult, stringArg, textResult } from '../tool.js'
import { MAX_WAIT_MS, readinessFrom, readinessProperties, tabIdField } from './fields.js'
import { missingTabResult, requireBrowser, type BrowserHostProvider } from './host.js'

export function waitForAction(browser: BrowserHostProvider): ToolAction {
  return {
    action: 'wait_for',
    description:
      'Wait until a tab reaches a load state, and optionally until a selector matches or text appears. ' +
      'Use it after navigate reported the page was not ready, or when a page updates itself after loading. ' +
      'Returns which state was reached and whether the condition was met.',
    inputSchema: {
      type: 'object',
      properties: { tab_id: tabIdField, ...readinessProperties },
      additionalProperties: false
    },
    timeoutMs: MAX_WAIT_MS + 5_000,
    async run(input) {
      const tabId = stringArg(input, 'tab_id')
      const ready = readinessFrom(input)
      const result = await requireBrowser(browser).waitFor(tabId, ready)
      if (!result) return failureResult(tabId ? `No tab with id ${tabId}` : 'No active tab')
      const outcome = describeReadiness(ready, result)
      const text = `${result.title ? `Page: ${result.title}\n` : ''}URL: ${result.url}\n${outcome}`
      return result.reached && result.conditionMet !== false ? textResult(text) : failureResult(text)
    }
  }
}
