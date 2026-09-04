import type { ToolAction } from '../action-tool.js'
import { jsonResult } from '../json-result.js'
import { booleanArg, failureResult, numberArg, stringArg } from '../tool.js'
import { tabIdField } from './fields.js'
import { requireBrowser, type BrowserHostProvider } from './host.js'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 200
const DEFAULT_MAX_TEXT = 200

export function queryAction(browser: BrowserHostProvider): ToolAction {
  return {
    action: 'query',
    description:
      'Find elements by CSS selector and return structured facts for each: tag, id, classes, role, ' +
      'accessible name, text, value, href, src, type, disabled, checked, visibility, and bounds, plus ' +
      'any attributes you name. text_contains narrows to elements whose text includes a substring; ' +
      'visible_only drops hidden ones. matched is the total before max_matches.',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: tabIdField,
        selector: { type: 'string', minLength: 1, description: 'CSS selector evaluated in the main frame.' },
        text_contains: { type: 'string', minLength: 1, description: 'Case-insensitive substring the element text must contain.' },
        attributes: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1 }, description: 'Extra attribute names to report per element.' },
        visible_only: { type: 'boolean', description: 'Only elements with a non-empty box that are not hidden. Default false.' },
        max_matches: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Maximum elements returned; default ${DEFAULT_LIMIT}.` },
        max_text: { type: 'integer', minimum: 20, maximum: 2_000, description: `Characters of text kept per element; default ${DEFAULT_MAX_TEXT}.` }
      },
      required: ['selector'],
      additionalProperties: false
    },
    async run(input) {
      const tabId = stringArg(input, 'tab_id')
      const attributes = Array.isArray(input.attributes) ? input.attributes.map((name) => String(name)) : undefined
      const result = await requireBrowser(browser).query(tabId, {
        selector: stringArg(input, 'selector')!,
        text: stringArg(input, 'text_contains'),
        attributes,
        visibleOnly: booleanArg(input, 'visible_only', false),
        limit: numberArg(input, 'max_matches', DEFAULT_LIMIT),
        maxText: numberArg(input, 'max_text', DEFAULT_MAX_TEXT)
      })
      if (!result) return failureResult(tabId ? `No tab with id ${tabId}` : 'No active tab')
      return jsonResult(result)
    }
  }
}
