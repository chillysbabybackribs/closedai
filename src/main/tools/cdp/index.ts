import { defineActionTool, type ToolAction } from '../action-tool.js'
import { failureResult, stringArg, type ToolNamespace } from '../tool.js'
import {
  eventCursorFrom,
  eventLimitFrom,
  paramsFrom,
  sessionIdField,
  sessionIdFrom,
  tabIdField,
  tabIdFrom
} from './fields.js'
import { requireCdp, type CdpHostProvider } from './host.js'
import { cdpPageTool } from './page.js'
import { jsonResult, objectSchema } from '../json-result.js'

export function cdpTools(cdp: CdpHostProvider): ToolNamespace {
  return {
    name: 'browser_cdp',
    description: 'Low-level Chrome DevTools Protocol access to tabs owned by the embedded browser.',
    tools: [
      defineActionTool({
        name: 'protocol',
        description:
          'Escape hatch: raw CDP commands to a ClosedAI browser tab and its instrumentation events, for ' +
          'inspection and debugging the page tool cannot do. Interaction belongs in the page tool ' +
          '(click, type, press_key, scroll) and screenshots in closedai_ui capture; Input.* and ' +
          'Page.captureScreenshot are refused here. Use capabilities to inspect the bundled Chromium ' +
          'protocol, targets to discover inspectable children, command for any domain method, and events ' +
          'after enabling the relevant domain. DOM nodes, runtime objects, frames, execution contexts, ' +
          'target sessions, and request ids are transient and may become invalid after navigation. ' +
          'Attach child targets with flatten=true and pass the returned session_id on later commands.',
        deferLoading: true,
        actions: actions(cdp)
      }),
      cdpPageTool(cdp)
    ]
  }
}

function actions(cdp: CdpHostProvider): ToolAction[] {
  return [
    {
      action: 'capabilities',
      description: 'Return Browser.getVersion and the domains supported by the selected tab target.',
      inputSchema: objectSchema({ tab_id: tabIdField }),
      run: async (input) => jsonResult(await requireCdp(cdp).capabilities(tabIdFrom(input)))
    },
    {
      action: 'targets',
      description: 'Return the selected tab target and currently discoverable CDP targets.',
      inputSchema: objectSchema({ tab_id: tabIdField }),
      run: async (input) => jsonResult(await requireCdp(cdp).targets(tabIdFrom(input)))
    },
    {
      action: 'command',
      description:
        'Send an arbitrary CDP Domain.method with a JSON params object. Optional session_id routes it to a flat child-target session.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        method: { type: 'string', minLength: 3, description: 'CDP method, for example DOM.getDocument or Network.enable.' },
        params: { type: 'object', description: 'The command parameters; defaults to an empty object.' },
        session_id: sessionIdField
      }, ['method']),
      run: async (input) => {
        const method = stringArg(input, 'method')!
        if (!/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/.test(method)) {
          throw new Error('`method` must use CDP Domain.method syntax')
        }
        const denied = deniedMethodAdvice(method)
        if (denied) return failureResult(denied)
        return jsonResult(await requireCdp(cdp).command(
          tabIdFrom(input), method, paramsFrom(input), sessionIdFrom(input)
        ))
      }
    },
    {
      action: 'events',
      description:
        'Read buffered CDP events after a cursor. Enable a domain first (for example Network.enable); use nextCursor on the following read.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        after_cursor: { type: 'integer', minimum: 0, description: 'Return events after this cursor; defaults to 0.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum events to return; defaults to 100.' },
        method_prefix: { type: 'string', minLength: 1, description: 'Optional prefix filter, for example Network. or Runtime.console.' }
      }),
      run: async (input) => jsonResult(requireCdp(cdp).events(
        tabIdFrom(input),
        eventCursorFrom(input),
        eventLimitFrom(input),
        stringArg(input, 'method_prefix')
      ))
    }
  ]
}

/**
 * Raw methods with a purpose-built tool: refuse them with a pointer instead of letting the
 * model rebuild input event-by-event (observed: 708 dispatchKeyEvent calls in one workspace)
 * or pull base64 screenshots through a text result.
 */
function deniedMethodAdvice(method: string): string | null {
  if (method.startsWith('Input.')) {
    return `${method} is disabled here: use the page tool instead — type inserts whole strings, ` +
      'press_key sends key chords, click/click_at click, and scroll scrolls. One call replaces an event sequence.'
  }
  if (method === 'Page.captureScreenshot') {
    return 'Page.captureScreenshot is disabled here: it returns base64 as text and bypasses the screenshot ' +
      'budget. Use closedai_ui capture with action browser_page (or app_window) instead.'
  }
  return null
}

export type { CdpHostProvider, CdpToolHost } from './host.js'
