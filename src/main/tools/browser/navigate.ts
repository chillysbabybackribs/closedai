import { describeReadiness } from '../../browser-page-ready.js'
import type { ToolAction } from '../action-tool.js'
import { booleanArg, failureResult, stringArg, textResult } from '../tool.js'
import { MAX_WAIT_MS, readinessFrom, readinessProperties, tabIdField, urlField } from './fields.js'
import { requireBrowser, type BrowserHostProvider } from './host.js'

export function navigateAction(browser: BrowserHostProvider): ToolAction {
  return {
    action: 'navigate',
    description:
      'Open a URL or search query in this chat’s assigned tab, wait for readiness, and return final URL, title, and load state. The first untargeted navigation opens an assigned tab and selects it; new_tab opens another. Pages run at full speed whether or not their tab is the selected one. Assignments keep other chats from acting in the tab until released, though any chat may read it; cookies and website accounts remain shared.',
    inputSchema: {
      type: 'object',
      properties: {
        url: urlField,
        tab_id: tabIdField,
        new_tab: { type: 'boolean', description: 'Open another tab assigned to this chat and select it.' },
        ...readinessProperties
      },
      required: ['url'],
      additionalProperties: false
    },
    timeoutMs: MAX_WAIT_MS + 5_000,
    async run(input) {
      const url = stringArg(input, 'url')!
      const requestedTabId = stringArg(input, 'tab_id')
      const newTab = booleanArg(input, 'new_tab', false)
      if (requestedTabId && newTab) return failureResult('navigate cannot combine tab_id with new_tab')
      const ready = readinessFrom(input)
      const outcome = await requireBrowser(browser).navigate(url, { tabId: requestedTabId, newTab, ready })
      if (!outcome.ok) return failureResult(`Navigation to ${url} failed: ${outcome.error}`)
      const { ready: result, tabId } = outcome
      return textResult(
        `Loaded: ${result.title || 'Untitled'}\nURL: ${result.url}\nTab: ${tabId}\n${describeReadiness(ready, result)}`
      )
    }
  }
}
