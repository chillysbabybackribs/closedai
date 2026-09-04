import type { ToolAction } from '../action-tool.js'
import { jsonResult } from '../json-result.js'
import { numberArg, stringArg } from '../tool.js'
import { DEFAULT_MAX_CHARS, maxCharsField, tabIdField } from './fields.js'
import { missingTabResult, requireBrowser, type BrowserHostProvider } from './host.js'

/** Page scripts can legitimately await network work; still bounded. */
const EVALUATE_TIMEOUT_MS = 30_000

export function evaluateAction(browser: BrowserHostProvider): ToolAction {
  return {
    action: 'evaluate',
    description:
      'Run JavaScript in the page and return the result as JSON. Write an expression, or statements ' +
      'ending in an explicit return; promises are awaited. DOM nodes come back as summaries (tag, id, ' +
      'classes, text), collections as arrays, cycles are cut, and the value is bounded by max_chars. ' +
      'Errors return ok false with the message and stack. For selector lookups prefer query, which is structured.',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: tabIdField,
        expression: { type: 'string', minLength: 1, maxLength: 20_000, description: 'JavaScript to run in the page\'s main frame.' },
        max_chars: maxCharsField
      },
      required: ['expression'],
      additionalProperties: false
    },
    timeoutMs: EVALUATE_TIMEOUT_MS,
    async run(input) {
      const tabId = stringArg(input, 'tab_id')
      const host = requireBrowser(browser)
      const result = await host.evaluate(tabId, {
        expression: stringArg(input, 'expression')!,
        maxChars: numberArg(input, 'max_chars', DEFAULT_MAX_CHARS)
      })
      if (!result) return missingTabResult(host, tabId)
      return jsonResult(result)
    }
  }
}
