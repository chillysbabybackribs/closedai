import { defineActionTool, type ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { booleanArg, failureResult, numberArg, stringArg, type JsonObject, type ToolDefinition } from '../tool.js'
import type { NetworkRuleAction } from '../../browser-network/network-rules.js'
import { requireNetwork, type NetworkHostProvider } from './network-host.js'

// The session's always-on request log, its wait primitive, explicit replay, and interception
// rules. Everything here is main-process state the app owns; nothing needs a debugger.

const DEFAULT_LIMIT = 40
const MAX_LIMIT = 200
const DEFAULT_WAIT_MS = 5_000
const MAX_WAIT_MS = 30_000
const BODY_TIMEOUT_MS = 45_000

const tabIdField: JsonObject = {
  type: 'string',
  description: 'Restrict to one tab. Omitted means every tab plus the session\'s own requests (tab_id null).'
}
const urlContainsField: JsonObject = { type: 'string', minLength: 1, description: 'Case-insensitive substring of the URL, for example /api/.' }
const methodField: JsonObject = { type: 'string', minLength: 1, description: 'HTTP method filter, for example POST.' }
const afterCursorField: JsonObject = {
  type: 'integer',
  minimum: 0,
  description: 'Only requests recorded after this cursor. Use the nextCursor of a previous listing, or take it before acting so a wait sees only what the action caused.'
}
const requestIdField: JsonObject = { type: 'string', minLength: 1, description: 'The id of a request from requests or wait.' }
const ruleIdField: JsonObject = { type: 'string', minLength: 1, description: 'A rule id from rules or add_rule.' }

export function networkTool(network: NetworkHostProvider): ToolDefinition {
  return defineActionTool({
    name: 'network',
    deferLoading: true,
    description:
      'The browser session\'s own network record: every request from every tab, with headers, status, ' +
      'timing, redirects, and post data, captured passively by the app so nothing needs enabling and ' +
      'records survive navigation within a bounded ring. Use requests to find endpoints and wait to catch ' +
      'a completed request after a cursor. Historical bodies require browser_cdp.protocol requests/body ' +
      'with exact CDP ids; this log does not capture bodies or map its ids to CDP ids. ' +
      'Use network_replay only to deliberately issue a new request. Rules block, redirect, or rewrite headers. Results are JSON.',
    actions: [requestsAction(network), waitAction(network), rulesAction(network), addRuleAction(network), removeRuleAction(network), clearAction(network)]
  })
}

function requestsAction(network: NetworkHostProvider): ToolAction {
  return {
    action: 'requests',
    description:
      'List recorded requests, most recent last. Filter by tab, URL substring, resource type (xhr, fetch, ' +
      'document, script, image…), method, status, or state (pending, completed, failed, blocked). ' +
      'Headers and post data are omitted unless include_headers is true; matched reports the total before max_requests.',
    inputSchema: objectSchema({
      tab_id: tabIdField,
      url_contains: urlContainsField,
      resource_type: { type: 'string', minLength: 1, description: 'Case-insensitive substring of the resource type.' },
      method: methodField,
      status: { type: 'integer', minimum: 100, maximum: 599, description: 'Exact HTTP status.' },
      state: { type: 'string', enum: ['pending', 'completed', 'failed', 'blocked'], description: 'Request state.' },
      after_cursor: afterCursorField,
      include_headers: { type: 'boolean', description: 'Include request and response headers and post data. Default false.' },
      max_requests: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Maximum requests returned; default ${DEFAULT_LIMIT}.` }
    }),
    run: async (input) => jsonResult(requireNetwork(network).requests({
      tabId: stringArg(input, 'tab_id'),
      url: stringArg(input, 'url_contains'),
      type: stringArg(input, 'resource_type'),
      method: stringArg(input, 'method'),
      status: input.status === undefined ? undefined : numberArg(input, 'status', 0),
      state: stringArg(input, 'state') as 'pending' | 'completed' | 'failed' | 'blocked' | undefined,
      afterCursor: input.after_cursor === undefined ? undefined : numberArg(input, 'after_cursor', 0),
      includeHeaders: booleanArg(input, 'include_headers', false),
      limit: numberArg(input, 'max_requests', DEFAULT_LIMIT)
    }))
  }
}

function waitAction(network: NetworkHostProvider): ToolAction {
  return {
    action: 'wait',
    description:
      'Wait until a request matching url_contains (and optionally method and tab) finishes, then return ' +
      'it with headers. Pass the after_cursor you read before acting so a request the page made earlier ' +
      'cannot satisfy the wait. Times out with matched false rather than failing.',
    inputSchema: objectSchema({
      tab_id: tabIdField,
      url_contains: urlContainsField,
      method: methodField,
      after_cursor: afterCursorField,
      timeout_ms: { type: 'integer', minimum: 100, maximum: MAX_WAIT_MS, description: `Milliseconds to wait; default ${DEFAULT_WAIT_MS}.` }
    }, ['url_contains']),
    timeoutMs: MAX_WAIT_MS + 5_000,
    run: async (input) => jsonResult(await requireNetwork(network).waitFor({
      tabId: stringArg(input, 'tab_id'),
      url: stringArg(input, 'url_contains'),
      method: stringArg(input, 'method'),
      afterCursor: numberArg(input, 'after_cursor', 0),
      timeoutMs: numberArg(input, 'timeout_ms', DEFAULT_WAIT_MS)
    }))
  }
}

export function networkReplayTool(network: NetworkHostProvider): ToolDefinition {
  return {
    name: 'network_replay',
    deferLoading: true,
    description:
      'Explicitly resend a request from embedded_browser.network requests/wait using its recorded method, ' +
      'headers and post data on the current signed-in session. This can repeat server-side effects, ' +
      'including POST mutations. Returns the NEW response with source replay, never historical evidence. ' +
      'For captured-only reads use browser_cdp.protocol requests/body. Binary/file uploads cannot be replayed.',
    inputSchema: objectSchema({ request_id: requestIdField }, ['request_id']),
    timeoutMs: BODY_TIMEOUT_MS,
    run: async (input) => jsonResult(await requireNetwork(network).replay(stringArg(input, 'request_id')!))
  }
}

function rulesAction(network: NetworkHostProvider): ToolAction {
  return {
    action: 'rules',
    description: 'List active interception rules with their hit counts.',
    inputSchema: objectSchema({}),
    run: async () => jsonResult({ rules: requireNetwork(network).rules() })
  }
}

function addRuleAction(network: NetworkHostProvider): ToolAction {
  return {
    action: 'add_rule',
    description:
      'Add an interception rule. block cancels matching requests; redirect sends them to redirect_url; ' +
      'request_headers and response_headers set (or, with a null value, remove) headers. url_pattern is a ' +
      'glob over the full URL (* matches anything) or a plain substring. Scope to one tab with tab_id; ' +
      'rules persist until removed or the app restarts.',
    inputSchema: objectSchema({
      rule_action: { type: 'string', enum: ['block', 'redirect', 'request_headers', 'response_headers'], description: 'What the rule does.' },
      url_pattern: { type: 'string', minLength: 1, description: 'Glob or substring matched against the full URL, case-insensitively.' },
      tab_id: tabIdField,
      redirect_url: { type: 'string', minLength: 1, description: 'Destination for a redirect rule.' },
      headers: { type: 'object', description: 'Header name to value for header rules; null removes the header.' },
      note: { type: 'string', maxLength: 200, description: 'Why the rule exists; shown in listings.' }
    }, ['rule_action', 'url_pattern']),
    run: async (input) => {
      const headers = input.headers
      if (headers !== undefined && (headers === null || typeof headers !== 'object' || Array.isArray(headers))) {
        return failureResult('`headers` must be an object of header names to string or null values')
      }
      const rule = requireNetwork(network).addRule({
        action: stringArg(input, 'rule_action') as NetworkRuleAction,
        urlPattern: stringArg(input, 'url_pattern')!,
        tabId: stringArg(input, 'tab_id') ?? null,
        redirectUrl: stringArg(input, 'redirect_url') ?? null,
        headers: headers === undefined ? null : headerValues(headers as Record<string, unknown>),
        note: stringArg(input, 'note') ?? null
      })
      return jsonResult({ added: rule })
    }
  }
}

function removeRuleAction(network: NetworkHostProvider): ToolAction {
  return {
    action: 'remove_rule',
    description: 'Remove an interception rule by id.',
    inputSchema: objectSchema({ rule_id: ruleIdField }, ['rule_id']),
    run: async (input) => {
      const id = stringArg(input, 'rule_id')!
      return requireNetwork(network).removeRule(id) ? jsonResult({ removed: id }) : failureResult(`No rule with id ${id}`)
    }
  }
}

function clearAction(network: NetworkHostProvider): ToolAction {
  return {
    action: 'clear',
    description: 'Forget recorded requests for one tab, or for everything when tab_id is omitted. Rules are kept.',
    inputSchema: objectSchema({ tab_id: tabIdField }),
    run: async (input) => jsonResult({ cleared: requireNetwork(network).clear(stringArg(input, 'tab_id')) })
  }
}

function headerValues(raw: Record<string, unknown>): Record<string, string | null> {
  const headers: Record<string, string | null> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (value !== null && typeof value !== 'string') throw new Error(`Header ${name} must be a string or null`)
    headers[name] = value
  }
  return headers
}
