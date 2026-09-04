import type { ToolAction } from '../action-tool.js'
import { jsonResult } from '../json-result.js'
import { stringArg, type JsonObject } from '../tool.js'
import { tabIdField, urlField } from './fields.js'
import { missingTabResult, requireBrowser, type BrowserHostProvider } from './host.js'
import type { PageFetchRequest } from '../../browser-page-fetch.js'

/** A data fetch is legitimately slower than reading rendered text, but still bounded. */
export const FETCH_TIMEOUT_MS = 45_000

// Shared by fetch and extract, and shared by identity: defineActionTool requires a field used
// by two actions to have the same schema object, so these are defined once and imported.
export const methodField: JsonObject = {
  type: 'string',
  enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
  description: 'HTTP method; defaults to GET.'
}

export const headersField: JsonObject = {
  type: 'object',
  description: 'Extra request headers. The tab already supplies its own cookies and origin.'
}

export const bodyField: JsonObject = {
  type: 'string',
  maxLength: 20_000,
  description: 'Request body, already serialised. Pair a JSON body with a content-type header.'
}

export function requestFrom(input: JsonObject, url: string): PageFetchRequest {
  return {
    url,
    method: stringArg(input, 'method', 'GET')!,
    headers: headersFrom(input),
    body: stringArg(input, 'body')
  }
}

/** Parse a JSON body when the response is JSON, so the caller can project or truncate it. */
export function parseBody(text: string, contentType: string | null): { json: unknown; isJson: boolean } {
  const looksJson = contentType?.includes('json') === true || /^\s*[[{]/.test(text)
  if (!looksJson) return { json: text, isJson: false }
  try {
    return { json: JSON.parse(text) as unknown, isJson: true }
  } catch {
    return { json: text, isJson: false }
  }
}

export function fetchAction(browser: BrowserHostProvider): ToolAction {
  return {
    action: 'fetch',
    description: 'Fetch a URL inside the tab (inherits cookies/origin); returns bounded JSON or text.',
    inputSchema: {
      type: 'object',
      properties: {
        url: urlField,
        method: methodField,
        headers: headersField,
        body: bodyField,
        tab_id: tabIdField
      },
      required: ['url'],
      additionalProperties: false
    },
    timeoutMs: FETCH_TIMEOUT_MS,
    async run(input) {
      const url = stringArg(input, 'url')!
      const tabId = stringArg(input, 'tab_id')
      const host = requireBrowser(browser)
      const response = await host.fetchPage(tabId, requestFrom(input, url))
      if (!response) return missingTabResult(host, tabId)
      const { json, isJson } = parseBody(response.text, response.contentType)
      return jsonResult({
        url: response.url,
        status: response.status,
        ok: response.ok,
        contentType: response.contentType,
        bodyLength: response.bodyLength,
        ...(response.truncated ? { bodyTruncatedAtCeiling: true } : {}),
        ...(isJson ? { json } : { text: response.text })
      })
    }
  }
}

function headersFrom(input: JsonObject): Record<string, string> | undefined {
  const raw = input.headers
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('`headers` must be an object')
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) headers[name] = String(value)
  return headers
}
