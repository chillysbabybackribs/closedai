import type { ToolAction } from '../action-tool.js'
import { jsonResult } from '../json-result.js'
import { failureResult, numberArg, stringArg, type JsonObject } from '../tool.js'
import { bodyField, FETCH_TIMEOUT_MS, headersField, methodField, parseBody, requestFrom } from './fetch.js'
import { MAX_CHARS, tabIdField, urlField } from './fields.js'
import { missingTabResult, requireBrowser, type BrowserHostProvider } from './host.js'
import { projectJson } from './project.js'

export function extractAction(browser: BrowserHostProvider): ToolAction {
  return {
    action: 'extract',
    description:
      'Pull named fields out of a JSON document and return only those. Reads the current tab when ' +
      'url is omitted, otherwise fetches the URL from inside the tab (method, headers, and body work ' +
      'as they do for fetch, so a POST endpoint is reachable). path selects the subtree, fields names ' +
      'what to keep from each item, limit caps the rows — the projection happens before the result is ' +
      'serialised, so a large response costs only the part you asked for.',
    inputSchema: {
      type: 'object',
      properties: {
        url: urlField,
        method: methodField,
        headers: headersField,
        body: bodyField,
        path: {
          type: 'string',
          minLength: 1,
          description: 'Dot/bracket path to the subtree, for example `data.items` or `results[0].rows`. Defaults to the whole document.'
        },
        fields: {
          type: 'array',
          maxItems: 40,
          items: { type: 'string', minLength: 1 },
          description: 'Field paths kept from each item, for example ["name","revenue.mrr"]. Every field when omitted.'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          description: 'Maximum items returned when the selection is an array.'
        },
        tab_id: tabIdField
      },
      additionalProperties: false
    },
    timeoutMs: FETCH_TIMEOUT_MS,
    async run(input) {
      const url = stringArg(input, 'url')
      const tabId = stringArg(input, 'tab_id')
      const host = requireBrowser(browser)
      const source = url
        ? await readFetched(host, tabId, input, url)
        : await readCurrentPage(host, tabId)
      if (!source) return missingTabResult(host, tabId)
      if (typeof source === 'string') return failureResult(source)

      const path = stringArg(input, 'path')
      const fields = fieldsFrom(input)
      const limit = input.limit === undefined ? undefined : numberArg(input, 'limit', 0)
      const projected = projectJson(source.document, { path, fields, limit })
      if (projected.value === undefined) {
        return failureResult(`No value at path ${JSON.stringify(path)}. Call fetch first to see the response shape.`)
      }
      return jsonResult({
        source: source.url,
        ...(source.status === null ? {} : { status: source.status }),
        ...(path ? { path } : {}),
        ...(projected.matched === null ? {} : { matched: projected.matched, returned: Array.isArray(projected.value) ? projected.value.length : 1 }),
        ...(projected.limited ? { limited: true } : {}),
        value: projected.value
      })
    }
  }
}

type ExtractSource = { document: unknown; url: string; status: number | null }

async function readFetched(
  host: ReturnType<typeof requireBrowser>,
  tabId: string | undefined,
  input: JsonObject,
  url: string
): Promise<ExtractSource | string | null> {
  const response = await host.fetchPage(tabId, requestFrom(input, url))
  if (!response) return null
  const { json, isJson } = parseBody(response.text, response.contentType)
  if (!isJson) return `${response.url} did not return JSON (status ${response.status}, content-type ${response.contentType ?? 'unknown'}). Use fetch or read_page for non-JSON.`
  return { document: json, url: response.url, status: response.status }
}

async function readCurrentPage(
  host: ReturnType<typeof requireBrowser>,
  tabId: string | undefined
): Promise<ExtractSource | string | null> {
  const page = await host.readPage(tabId, { maxChars: MAX_CHARS, raw: true })
  if (!page) return null
  const { json, isJson } = parseBody(page.text, null)
  if (!isJson) return `${page.url} is not a JSON document. Use read_page for rendered text, or pass a url to fetch an API.`
  return { document: json, url: page.url, status: null }
}

function fieldsFrom(input: JsonObject): string[] | undefined {
  const raw = input.fields
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) throw new Error('`fields` must be an array of strings')
  return raw.map((field) => String(field))
}
