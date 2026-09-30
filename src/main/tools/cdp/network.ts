import type { ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { failureResult, numberArg, stringArg } from '../tool.js'
import { projectionFieldsField } from '../browser/fields.js'
import { projectJson } from '../browser/project.js'
import { textWindow } from '../browser/text-window.js'
import { normalizeCdpSessionId, sessionIdField, tabIdField } from './fields.js'
import { requireCdp, type CdpHostProvider } from './host.js'

const DEFAULT_REQUEST_LIMIT = 60

export function requestsAction(cdp: CdpHostProvider): ToolAction {
  return {
    action: 'requests',
    description:
      'List requests from the targeted tab. Resource Timing can reveal earlier XHR/fetch URLs without a reload; ' +
      'method, status, and body request ids require Network capture. This enables capture on the root and attached ' +
      'or future frames and workers; check childSessions for refusals. Repeated URLs have distinct request ids; ' +
      'for child-target rows, pass sessionId to body. Timing-only URLs are discovery hints.',
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
      'reissues a request; expired or unavailable bodies fail. Project captured JSON with json_path/fields/max_items before returning it; text uses max_chars/offset. Enable requests before navigation when bodies will matter.',
    inputSchema: objectSchema({
      tab_id: tabIdField,
      session_id: sessionIdField,
      request_id: { type: 'string', minLength: 1, description: 'A requestId reported by the requests action.' },
      json_path: { type: 'string', minLength: 1, description: 'Dot/bracket path in the captured JSON body, for example hits or data.items.' },
      fields: projectionFieldsField,
      max_items: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum projected JSON array items.' },
      max_chars: { type: 'integer', minimum: 200, maximum: 100000, description: 'Captured text character limit; default 6000, also bounded by the output budget.' },
      offset: { type: 'integer', minimum: 0, description: 'Character offset in captured text; use nextOffset to continue without reissuing the request.' }
    }, ['request_id']),
    run: async (input) => {
      const response = await requireCdp(cdp).responseBody(
        stringArg(input, 'tab_id'),
        stringArg(input, 'request_id')!,
        normalizeCdpSessionId(stringArg(input, 'session_id'))
      ) as Record<string, unknown>
      const { text, ...metadata } = response
      const hasProjection = input.json_path !== undefined || input.fields !== undefined || input.max_items !== undefined
      if (hasProjection) {
        if (input.offset !== undefined) return failureResult('Use JSON projection or text offset, not both.')
        if (typeof text !== 'string') return failureResult('This captured body has no text to project.')
        let json: unknown
        try { json = JSON.parse(text) } catch { return failureResult('This captured body is not valid JSON; omit projection fields to read its text.') }
        const projected = projectJson(json, {
          path: stringArg(input, 'json_path'),
          fields: Array.isArray(input.fields) ? input.fields.map(String) : undefined,
          limit: input.max_items === undefined ? undefined : numberArg(input, 'max_items', 0)
        })
        if (projected.value === undefined) return failureResult(`No value at json_path ${JSON.stringify(input.json_path)} in the captured body.`)
        return jsonResult({ ...metadata, json: projected.value, matched: projected.matched, limited: projected.limited })
      }
      return typeof text === 'string'
        ? textWindow(text, metadata, { maxChars: numberArg(input, 'max_chars', 6000), offset: numberArg(input, 'offset', 0) })
        : jsonResult(response)
    }
  }
}
