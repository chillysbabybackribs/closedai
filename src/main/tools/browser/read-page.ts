import type { ToolAction } from '../action-tool.js'
import { failureResult, numberArg, stringArg, textResult } from '../tool.js'
import { truncateText } from '../truncate-json.js'
import { DEFAULT_MAX_CHARS, maxCharsField, selectorField, tabIdField } from './fields.js'
import { missingTabResult, requireBrowser, type BrowserHostProvider } from './host.js'

const TRUNCATION_ADVICE =
  'Raise max_chars, pass a selector, or use extract with a path and fields to project only what you need.'

export function readPageAction(browser: BrowserHostProvider): ToolAction {
  return {
    action: 'read_page',
    description:
      'Read the visible text of a tab (the active tab unless tab_id is given) with its title, URL, ' +
      'and load state. Pass selector to read one element instead of the whole page. Long pages are ' +
      'truncated; raise max_chars if you need more. A JSON body is shrunk structurally (shorter ' +
      'strings, fewer array items) so it stays parseable instead of being cut mid-document — but ' +
      'prefer extract for JSON, which returns only the fields you name. If the load state is not ' +
      '"complete", call wait_for first.',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: tabIdField,
        selector: selectorField,
        max_chars: maxCharsField
      },
      additionalProperties: false
    },
    async run(input) {
      const tabId = stringArg(input, 'tab_id')
      const selector = stringArg(input, 'selector')
      const maxChars = numberArg(input, 'max_chars', DEFAULT_MAX_CHARS)
      const host = requireBrowser(browser)
      const page = await host.readPage(tabId, { selector, maxChars, raw: true })
      if (!page) {
        if (selector) return failureResult(`Nothing matches selector ${JSON.stringify(selector)}`)
        return missingTabResult(host, tabId)
      }
      const header = `Title: ${page.title || 'Untitled'}\nURL: ${page.url}\nLoad state: ${page.readyState}`
      // The page hands back its text unsliced, so the bound applied here can respect the
      // content: `truncateText` shrinks JSON structurally and only falls back to a plain cut
      // for prose. Cutting a JSON document at N characters yields something that will not parse.
      const bounded = truncateText(page.text || '(no visible text)', maxChars, TRUNCATION_ADVICE)
      const ceiling = page.truncated ? '\n\n[The page exceeded the read ceiling; earlier content only]' : ''
      return textResult(`${header}\n\n${bounded.text}${ceiling}`)
    }
  }
}
