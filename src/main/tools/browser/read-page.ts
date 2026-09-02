import type { ToolAction } from '../action-tool.js'
import { failureResult, numberArg, stringArg, textResult } from '../tool.js'
import { DEFAULT_MAX_CHARS, MAX_CHARS, tabIdField } from './fields.js'
import { requireBrowser, type BrowserHostProvider } from './host.js'

export function readPageAction(browser: BrowserHostProvider): ToolAction {
  return {
    action: 'read_page',
    description:
      'Read the visible text of a tab (the active tab unless tab_id is given) with its title, URL, ' +
      'and load state. Pass selector to read one element instead of the whole page. Long pages are ' +
      'truncated; raise max_chars if you need more. If the load state is not "complete", call wait_for first.',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: tabIdField,
        selector: { type: 'string', minLength: 1, description: 'CSS selector of the element to read. Defaults to the whole page.' },
        max_chars: { type: 'integer', minimum: 200, maximum: MAX_CHARS, description: `Text limit; default ${DEFAULT_MAX_CHARS}.` }
      },
      additionalProperties: false
    },
    async run(input) {
      const tabId = stringArg(input, 'tab_id')
      const selector = stringArg(input, 'selector')
      const maxChars = numberArg(input, 'max_chars', DEFAULT_MAX_CHARS)
      const page = await requireBrowser(browser).readPage(tabId, { selector, maxChars })
      if (!page) {
        if (selector) return failureResult(`Nothing matches selector ${JSON.stringify(selector)}`)
        return failureResult(tabId ? `No tab with id ${tabId}` : 'No active tab')
      }
      const header = `Title: ${page.title || 'Untitled'}\nURL: ${page.url}\nLoad state: ${page.readyState}`
      const body = page.text || '(no visible text)'
      const footer = page.truncated ? `\n\n[Truncated to ${maxChars} characters; raise max_chars for more]` : ''
      return textResult(`${header}\n\n${body}${footer}`)
    }
  }
}
