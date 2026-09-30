import { setTimeout as delay } from 'node:timers/promises'
import { isStaleCdpResponseBodyError } from '../../cdp/cdp-network.js'
import { defineTool, failureResult, numberArg, stringArg, type ToolDefinition } from '../tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { projectionFieldsField, readinessFrom, readinessProperties, urlField } from '../browser/fields.js'
import { projectJson } from '../browser/project.js'
import { requireBrowser, type BrowserHostProvider } from '../browser/host.js'
import { normalizeCdpSessionId, tabIdField, tabIdFrom } from './fields.js'
import { requireCdp, type CdpHostProvider } from './host.js'

type CapturedRequest = {
  url?: string
  method?: string | null
  type?: string | null
  requestId?: string | null
  sessionId?: string | null
  status?: number | null
}

/** One call: arm CDP capture, navigate, pick matching XHR/fetch, project JSON. */
export function captureSpaTool(cdp: CdpHostProvider, browser: BrowserHostProvider): ToolDefinition {
  return defineTool({
    name: 'capture_spa',
    deferLoading: true,
    description:
      'Arm CDP capture, navigate to url, return projected JSON from the newest matching XHR/fetch with a JSON body (non-JSON matches are skipped). ' +
      'Without json_path/fields/max_items, a large body returns shape plus a 3-item scalar preview of its largest array. ' +
      'Example: url https://hn.algolia.com/?q=electron, url_contains Item_dev/query, json_path hits, fields [title], max_items 3. ' +
      'Cold start: omit tab_id or set new_tab true — a tab is created for this chat. Static docs → session fetch or fetch_many.',
    inputSchema: objectSchema({
      url: urlField,
      tab_id: tabIdField,
      new_tab: { type: 'boolean', description: 'Open another tab assigned to this chat and select it.' },
      url_contains: { type: 'string', minLength: 1, description: 'Case-insensitive substring on the captured request URL, for example Item_dev/query for HN Algolia search.' },
      resource_type: { type: 'string', minLength: 1, description: 'Optional filter on resource type, for example xhr or fetch.' },
      json_path: { type: 'string', minLength: 1, description: 'Dot/bracket path in the captured JSON body.' },
      fields: projectionFieldsField,
      max_items: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum projected array items.' },
      max_requests: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum requests scanned after navigation; default 60.' },
      ...readinessProperties
    }, ['url', 'url_contains']),
    timeoutMs: 45_000,
    run: async (input) => {
      const url = stringArg(input, 'url')!
      const urlContains = stringArg(input, 'url_contains')!.toLowerCase()
      const tabId = tabIdFrom(input)
      const cdpHost = requireCdp(cdp)
      await cdpHost.networkRequests(tabId, { limit: 1 })
      const ready = readinessFrom(input)
      const newTab = input.new_tab === true
      const requestedTabId = stringArg(input, 'tab_id')
      if (requestedTabId && newTab) return failureResult('capture_spa cannot combine tab_id with new_tab')
      const navigation = await requireBrowser(browser).navigate(url, { tabId: requestedTabId, newTab, ready })
      if (!navigation.ok) return failureResult(`Navigation to ${url} failed: ${navigation.error}`)
      const activeTabId = navigation.tabId
      const listed = await cdpHost.networkRequests(activeTabId, {
        url: stringArg(input, 'url_contains'),
        type: stringArg(input, 'resource_type'),
        limit: numberArg(input, 'max_requests', 60)
      }) as { requests?: CapturedRequest[]; capturing?: boolean }
      const requests = listed.requests ?? []
      const typeFilter = stringArg(input, 'resource_type')
      const candidates = requests.filter((row) => {
        if (!row.requestId) return false
        if (!(row.url ?? '').toLowerCase().includes(urlContains)) return false
        if (typeFilter && (row.type ?? '').toLowerCase() !== typeFilter.toLowerCase()) return false
        return true
      })
      const found = await lastJsonCandidate(cdpHost, activeTabId, candidates)
      if (!found) {
        return failureResult(
          candidates.length
            ? 'Matched requests lack captured body ids. Retry with a narrower url_contains or wait for idle.'
            : `No captured request matched url_contains ${JSON.stringify(stringArg(input, 'url_contains'))}. Check resource_type or the substring.`
        )
      }
      if ('failure' in found) return failureResult(found.failure)
      const { picked, response, json, skippedNonJson } = found
      const unprojected = input.json_path === undefined && input.fields === undefined && input.max_items === undefined
      const bodyChars = JSON.stringify(json).length
      if (unprojected && bodyChars > UNPROJECTED_BODY_BUDGET) {
        const { text: _body, ...bodyMetadata } = response
        return jsonResult({
          ...resultHeader(activeTabId, navigation.ready, listed.capturing, picked, skippedNonJson),
          ...bodyMetadata,
          bodyChars,
          ...jsonPreview(json)
        })
      }
      const projected = projectJson(json, {
        path: stringArg(input, 'json_path'),
        fields: Array.isArray(input.fields) ? input.fields.map(String) : undefined,
        limit: input.max_items === undefined ? undefined : numberArg(input, 'max_items', 0)
      })
      if (projected.value === undefined) {
        return failureResult(`No value at json_path ${JSON.stringify(input.json_path)} in the captured body.`)
      }
      const { text: _drop, ...metadata } = response
      return jsonResult({
        ...resultHeader(activeTabId, navigation.ready, listed.capturing, picked, skippedNonJson),
        ...metadata,
        json: projected.value,
        matched: projected.matched,
        limited: projected.limited
      })
    }
  })
}

const BODY_READ_RETRY_MS = [0, 120, 320] as const
// A loose url_contains (the API host) also matches beacons and scripts; newest-first, skip bodies
// that are not JSON rather than failing on the first one.
const MAX_BODY_CANDIDATES = 6
// Unprojected bodies above this size come back as a preview so the result stays inline in lanes
// that spill large tool output to files (Antigravity past ~4 KB).
const UNPROJECTED_BODY_BUDGET = 2_500
const PREVIEW_ITEMS = 3
const PREVIEW_STRING_CHARS = 160
const SHAPE_KEYS = 20

type FoundBody = { picked: CapturedRequest; response: Record<string, unknown>; json: unknown; skippedNonJson: number }

async function lastJsonCandidate(
  cdpHost: ReturnType<typeof requireCdp>,
  tabId: string,
  candidates: CapturedRequest[]
): Promise<FoundBody | { failure: string } | null> {
  const withIds = candidates.filter((row) => row.requestId)
  if (!withIds.length) return null
  const checked = withIds.slice(-MAX_BODY_CANDIDATES).reverse()
  let lastError: unknown
  for (const [index, picked] of checked.entries()) {
    let response: Record<string, unknown>
    try {
      response = await readCapturedResponseBody(cdpHost, tabId, picked.requestId!, normalizeCdpSessionId(picked.sessionId)) as Record<string, unknown>
    } catch (error) {
      lastError = error
      continue
    }
    const text = typeof response.text === 'string' ? response.text : ''
    try {
      return { picked, response, json: JSON.parse(text), skippedNonJson: index }
    } catch { /* keep looking */ }
  }
  const urls = checked.map((row) => (row.url ?? '').slice(0, 160))
  const cause = lastError ? ` Last body read error: ${lastError instanceof Error ? lastError.message : String(lastError)}.` : ''
  return { failure: `None of the ${checked.length} newest matching requests returned a JSON body; narrow url_contains to the API path (for example Item_dev/query). Checked: ${urls.join(' | ')}.${cause}` }
}

function resultHeader(
  tabId: string,
  ready: { url: string; title: string },
  capturing: boolean | undefined,
  picked: CapturedRequest,
  skippedNonJson: number
) {
  return {
    tabId,
    url: ready.url,
    title: ready.title,
    capturing: capturing ?? true,
    matchedRequest: {
      url: picked.url,
      method: picked.method,
      type: picked.type,
      status: picked.status,
      requestId: picked.requestId,
      sessionId: picked.sessionId ?? null
    },
    ...(skippedNonJson ? { skippedNonJson } : {})
  }
}

/** Shape plus the first items of the largest array, scalar fields only, for a body the caller did not project. */
function jsonPreview(json: unknown) {
  const largest = largestArray(json)
  const preview = largest
    ? { json_path: largest.path, count: largest.items.length, items: largest.items.slice(0, PREVIEW_ITEMS).map(scalarView) }
    : undefined
  const hint = largest
    ? `Unprojected body; preview shows the first ${preview!.items.length} of ${largest.items.length} items at ${largest.path} (scalar fields). Pass json_path/fields/max_items for exact data.`
    : 'Unprojected body; pass json_path/fields/max_items to select data.'
  return { shape: shapeOf(json), ...(preview ? { preview } : {}), hint }
}

function largestArray(json: unknown): { path: string; items: unknown[] } | null {
  let best: { path: string; items: unknown[] } | null = null
  const consider = (path: string, value: unknown) => {
    if (Array.isArray(value) && value.length && (!best || value.length > best.items.length)) best = { path, items: value }
  }
  if (Array.isArray(json)) return json.length ? { path: '', items: json } : null
  if (!isRecord(json)) return null
  for (const [key, value] of Object.entries(json)) {
    consider(key, value)
    if (isRecord(value)) for (const [inner, nested] of Object.entries(value)) consider(`${key}.${inner}`, nested)
  }
  return best
}

function shapeOf(json: unknown): Record<string, string> | string {
  if (!isRecord(json)) return describe(json)
  return Object.fromEntries(Object.entries(json).slice(0, SHAPE_KEYS).map(([key, value]) => [key, describe(value)]))
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`
  return value === null ? 'null' : typeof value
}

function scalarView(item: unknown): unknown {
  if (typeof item === 'string') return clip(item)
  if (!isRecord(item)) return Array.isArray(item) ? describe(item) : item
  return Object.fromEntries(Object.entries(item)
    .filter(([, value]) => value === null || typeof value !== 'object')
    .map(([key, value]) => [key, typeof value === 'string' ? clip(value) : value]))
}

function clip(text: string): string {
  return text.length > PREVIEW_STRING_CHARS ? `${text.slice(0, PREVIEW_STRING_CHARS)}…` : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readCapturedResponseBody(
  cdpHost: ReturnType<typeof requireCdp>,
  tabId: string,
  requestId: string,
  sessionId: string | undefined
): Promise<unknown> {
  let lastError: unknown
  for (const waitMs of BODY_READ_RETRY_MS) {
    if (waitMs) await delay(waitMs)
    try {
      return await cdpHost.responseBody(tabId, requestId, sessionId)
    } catch (error) {
      lastError = error
      if (!isStaleCdpResponseBodyError(error)) throw error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
