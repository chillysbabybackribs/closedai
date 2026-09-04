import { defineActionTool } from '../action-tool.js'
import type { ToolNamespace } from '../tool.js'
import { consoleAction } from './console.js'
import { evaluateAction } from './evaluate.js'
import { extractAction } from './extract.js'
import { fetchAction } from './fetch.js'
import type { BrowserHostProvider } from './host.js'
import { navigateAction } from './navigate.js'
import { networkTool } from './network.js'
import type { NetworkHostProvider, SessionHostProvider } from './network-host.js'
import { queryAction } from './query.js'
import { readPageAction } from './read-page.js'
import { sessionTool } from './session.js'
import { waitForAction } from './wait-for.js'

export type { BrowserHostProvider, BrowserToolHost, NavigateOutcome } from './host.js'
export type { NetworkBodyResult, NetworkHostProvider, NetworkToolHost, SessionHostProvider, SessionToolHost } from './network-host.js'

/**
 * Namespace `embedded_browser`: the browser the user is looking at, and the session the app
 * owns underneath it. `page` reads and runs script in a tab; `network` is the session's own
 * request record with interception rules; `session` makes requests and edits cookies with the
 * user's signed-in session and no page involved. Actions that send real input to a page live
 * in browser_cdp so their trust level can differ. Not named `browser`: the app-server rejects
 * namespaces that collide with the Responses API's built-in tools.
 */
export function browserTools(
  browser: BrowserHostProvider,
  network?: NetworkHostProvider,
  sessions?: SessionHostProvider
): ToolNamespace {
  return {
    name: 'embedded_browser',
    description: 'The embedded web browser shown next to this chat, its network traffic, and its signed-in session.',
    tools: [
      defineActionTool({
        name: 'page',
        description:
          'Read-only access to the embedded browser the user is looking at. Use navigate to open a page, ' +
          'read_page to get its text, wait_for when content loads late, query for structured facts about ' +
          'elements matching a selector, evaluate to run JavaScript and get a bounded JSON result, and ' +
          'console for the tab\'s logged messages and errors. For data rather than rendered text, use ' +
          'fetch to call an endpoint from inside the tab (inheriting its origin and session) and extract ' +
          'to return only the fields you name from a JSON response; for cross-origin APIs use ' +
          'embedded_browser.session fetch instead. Every load reports the ready state it reached; trust ' +
          '"complete", re-check anything else. navigate, read_page, and wait_for return plain text (a ' +
          'Title / URL / Load state header, then the content); the rest return JSON.',
        actions: [
          navigateAction(browser),
          readPageAction(browser),
          waitForAction(browser),
          fetchAction(browser),
          extractAction(browser),
          queryAction(browser),
          evaluateAction(browser),
          consoleAction(browser)
        ]
      }),
      ...(network ? [networkTool(network)] : []),
      ...(sessions ? [sessionTool(sessions)] : [])
    ]
  }
}
