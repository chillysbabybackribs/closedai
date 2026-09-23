import { describeReadiness } from '../../browser-page-ready.js'
import { isSearchEnginePageUrl, urlInputKind } from '../../browser-url.js'
import type { ToolAction } from '../action-tool.js'
import { booleanArg, failureResult, stringArg, textResult } from '../tool.js'
import { MAX_WAIT_MS, readinessFrom, readinessProperties, tabIdField, urlField } from './fields.js'
import { requireBrowser, type BrowserHostProvider } from './host.js'

// Discovery belongs to the search APIs, never to a search-engine page in the visible browser
// (docs/model-context.md). The omnibox still searches free text for the user — that is a person
// typing — but this tool refused it as of 2026-09-22: the field used to advertise "or search
// query", and a model reading only tool schemas took the invitation, leaving the user staring at
// a Google results page instead of a source. Both spellings are refused, the bare query and an
// explicit engine URL, and the error names the tool that does the job.
function searchEngineRefusal(url: string): string | null {
  const kind = urlInputKind(url)
  if (kind === 'search') {
    return `navigate needs a URL, not the search text ${JSON.stringify(url)}. ` +
      'Discovery belongs to search.query (or search.run for research): it returns sources and opens one in this chat’s tab. ' +
      'Navigate to a source URL once you have it.'
  }
  if (kind === 'absolute' && isSearchEnginePageUrl(url)) {
    return `navigate refuses the search-engine page ${url}. ` +
      'Use search.query (or search.run) for discovery, then navigate to a source URL from its results.'
  }
  return null
}

export function navigateAction(browser: BrowserHostProvider): ToolAction {
  return {
    action: 'navigate',
    description:
      'Navigate to a URL (not search text or search-engine pages — use search.query/run). Returns URL, title, and load state after readiness. ' +
      'First untargeted call assigns a tab; new_tab adds another. tab_id targets a known tab; other chats’ assigned tabs are read-only.',
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
      const refusal = searchEngineRefusal(url)
      if (refusal) return failureResult(refusal)
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
