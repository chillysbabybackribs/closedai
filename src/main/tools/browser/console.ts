import type { ToolAction } from '../action-tool.js'
import { jsonResult } from '../json-result.js'
import { booleanArg, failureResult, numberArg, stringArg } from '../tool.js'
import type { ConsoleLevel } from '../../browser-network/console-log.js'
import { tabIdField } from './fields.js'
import { requireBrowser, type BrowserHostProvider } from './host.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 300

export function consoleAction(browser: BrowserHostProvider): ToolAction {
  return {
    action: 'console',
    description:
      'Console messages and page errors a tab has logged, captured continuously by the app with no ' +
      'setup, plus navigation markers. min_level error returns only errors; since_navigation keeps ' +
      'entries from the latest load; after_cursor reads incrementally. Uncaught exceptions appear as errors.',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: tabIdField,
        min_level: { type: 'string', enum: ['debug', 'info', 'warning', 'error'], description: 'Lowest level to include; default debug (everything).' },
        contains: { type: 'string', minLength: 1, description: 'Case-insensitive substring the message must contain.' },
        since_navigation: { type: 'boolean', description: 'Only entries since the tab\'s most recent navigation. Default false.' },
        after_cursor: { type: 'integer', minimum: 0, description: 'Only entries after this cursor; use nextCursor from a previous call.' },
        max_entries: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Maximum entries returned; default ${DEFAULT_LIMIT}.` }
      },
      additionalProperties: false
    },
    async run(input) {
      const tabId = stringArg(input, 'tab_id')
      const listing = requireBrowser(browser).consoleMessages(tabId, {
        minLevel: stringArg(input, 'min_level') as ConsoleLevel | undefined,
        contains: stringArg(input, 'contains'),
        sinceNavigation: booleanArg(input, 'since_navigation', false),
        afterCursor: input.after_cursor === undefined ? undefined : numberArg(input, 'after_cursor', 0),
        limit: numberArg(input, 'max_entries', DEFAULT_LIMIT)
      })
      if (!listing) return failureResult(tabId ? `No tab with id ${tabId}` : 'No active tab')
      return jsonResult(listing)
    }
  }
}
