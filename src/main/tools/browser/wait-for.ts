import { describeReadiness } from '../../browser-page-ready.js'
import type { ToolAction } from '../action-tool.js'
import { stringArg, textResult, timeoutResult, usageResult } from '../tool.js'
import { MAX_WAIT_MS, readinessFrom, readinessProperties, tabIdField } from './fields.js'
import { missingTabResult, requireBrowser, type BrowserHostProvider } from './host.js'

export function waitForAction(browser: BrowserHostProvider): ToolAction {
  return {
    action: 'wait_for',
    description: 'Wait for load state and optional CSS selector or text; use after incomplete navigate, or when a page updates itself after loading. An unmet wait is an error reporting the state reached and which condition was missing.',
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
      if (result.selectorError) return usageResult(outcome)
      // The outcome leads: it is the answer, and it is all a truncated log line keeps.
      const where = `${result.url ? `\nURL: ${result.url}` : ''}${result.title ? ` — ${result.title}` : ''}`
      const text = `${outcome}${where}`
      if (result.reached && result.conditionMet !== false) return textResult(text)
      // A condition that did not arrive in time is this tool working, not breaking: it is
      // counted as a timeout so exploratory waits stay out of the error count.
      return timeoutResult(text)
    }
  }
}
