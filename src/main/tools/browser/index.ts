import { defineActionTool } from '../action-tool.js'
import type { ToolNamespace } from '../tool.js'
import type { BrowserHostProvider } from './host.js'
import { navigateAction } from './navigate.js'
import { readPageAction } from './read-page.js'
import { waitForAction } from './wait-for.js'

export type { BrowserHostProvider, BrowserToolHost, NavigateOutcome } from './host.js'

/**
 * Namespace `embedded_browser`: the browser the user is looking at. One read-only verb tool
 * for now; actions that change pages (click, type, submit) belong in a separate tool so
 * their trust level can differ. Not named `browser`: the app-server rejects namespaces that
 * collide with the Responses API's built-in tools.
 */
export function browserTools(browser: BrowserHostProvider): ToolNamespace {
  return {
    name: 'embedded_browser',
    description: 'The embedded web browser shown next to this chat. Open pages and read what is on them.',
    tools: [
      defineActionTool({
        name: 'page',
        description:
          'Read-only access to the embedded browser the user is looking at. Use navigate to open a page, ' +
          'read_page to get its text, and wait_for when content loads late. Every load reports the ready ' +
          'state it reached; trust "complete", re-check anything else.',
        actions: [navigateAction(browser), readPageAction(browser), waitForAction(browser)]
      })
    ]
  }
}
