import { describeReadiness } from '../../browser-page-ready.js'
import type { ToolAction } from '../action-tool.js'
import { booleanArg, failureResult, stringArg, textResult } from '../tool.js'
import { MAX_WAIT_MS, readinessFrom, readinessProperties } from './fields.js'
import { requireBrowser, type BrowserHostProvider } from './host.js'

export function navigateAction(browser: BrowserHostProvider): ToolAction {
  return {
    action: 'navigate',
    description:
      'Open a URL (or a search query) in the embedded browser, then wait until the page is ready. ' +
      'Returns the final URL, title, and exactly which ready state was reached, so you know whether ' +
      'read_page will see complete content. Loads in the active tab unless new_tab is true.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', minLength: 1, description: 'An absolute URL, or a search query.' },
        new_tab: { type: 'boolean', description: 'Open in a new tab instead of the active one.' },
        ...readinessProperties
      },
      required: ['url'],
      additionalProperties: false
    },
    timeoutMs: MAX_WAIT_MS + 5_000,
    async run(input) {
      const url = stringArg(input, 'url')!
      const newTab = booleanArg(input, 'new_tab', false)
      const ready = readinessFrom(input)
      const outcome = await requireBrowser(browser).navigate(url, { newTab, ready })
      if (!outcome.ok) return failureResult(`Navigation to ${url} failed: ${outcome.error}`)
      const { ready: result, tabId } = outcome
      return textResult(
        `Loaded: ${result.title || 'Untitled'}\nURL: ${result.url}\nTab: ${tabId}\n${describeReadiness(ready, result)}`
      )
    }
  }
}
