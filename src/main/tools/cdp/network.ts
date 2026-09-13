import type { ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { numberArg, stringArg } from '../tool.js'
import { sessionIdField, tabIdField } from './fields.js'
import { requireCdp, type CdpHostProvider } from './host.js'

const DEFAULT_REQUEST_LIMIT = 60

export function requestsAction(cdp: CdpHostProvider): ToolAction {
  return {
    action: 'requests',
    description:
      'List the network requests a tab has made — the fastest way to find the API behind a page ' +
      'instead of reading its bundles. Resource timing answers retroactively, so a tab that loaded ' +
      'before anyone was watching still reports its XHR and fetch URLs with no reload; entries seen ' +
      'while Network capture was on also carry method, status, and a request id for body. This call ' +
      'turns root capture on, so calling it once and acting on the page fills in the rest. Repeated URLs ' +
      'retain distinct request ids; sessionId identifies child-target traffic already captured. Enable ' +
      'Network in a child session explicitly when needed. Timing-only URLs are discovery hints.',
    inputSchema: objectSchema({
      tab_id: tabIdField,
      url_contains: { type: 'string', minLength: 1, description: 'Case-insensitive substring filter on the URL, for example /api/.' },
      resource_type: { type: 'string', minLength: 1, description: 'Case-insensitive filter on the resource type, for example xhr, fetch, or script.' },
      max_requests: { type: 'integer', minimum: 1, maximum: 200, description: `Maximum requests returned; defaults to ${DEFAULT_REQUEST_LIMIT}.` }
    }),
    run: async (input) => jsonResult(await requireCdp(cdp).networkRequests(stringArg(input, 'tab_id'), {
      url: stringArg(input, 'url_contains'),
      type: stringArg(input, 'resource_type'),
      limit: numberArg(input, 'max_requests', DEFAULT_REQUEST_LIMIT)
    }))
  }
}

export function bodyAction(cdp: CdpHostProvider): ToolAction {
  return {
    action: 'body',
    description:
      'Return the response body for a request id from requests. Text comes back decoded; a binary ' +
      'body is reported by size rather than dumped. Request ids are transient — they belong to the ' +
      'current capture. Pass the listed sessionId as session_id for child-target requests. This never ' +
      'reissues a request; expired or unavailable bodies fail. Reacquire ids after navigation or detach.',
    inputSchema: objectSchema({
      tab_id: tabIdField,
      session_id: sessionIdField,
      request_id: { type: 'string', minLength: 1, description: 'A requestId reported by the requests action.' }
    }, ['request_id']),
    run: async (input) => jsonResult(
      await requireCdp(cdp).responseBody(stringArg(input, 'tab_id'), stringArg(input, 'request_id')!, stringArg(input, 'session_id'))
    )
  }
}
