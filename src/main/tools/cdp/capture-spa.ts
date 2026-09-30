import { defineTool, failureResult, numberArg, stringArg, type ToolDefinition } from '../tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { projectionFieldsField, readinessFrom, readinessProperties, urlField } from '../browser/fields.js'
import { projectJson } from '../browser/project.js'
import { requireBrowser, type BrowserHostProvider } from '../browser/host.js'
import { tabIdField, tabIdFrom } from './fields.js'
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
      'Load a page URL with CDP network capture, then return projected JSON from the best matching XHR/fetch. ' +
      'Use for SPA APIs (search endpoints). Static docs → embedded_browser.session fetch or fetch_many. Opens a tab.',
    inputSchema: objectSchema({
      url: urlField,
      tab_id: tabIdField,
      new_tab: { type: 'boolean', description: 'Open another tab assigned to this chat and select it.' },
      url_contains: { type: 'string', minLength: 1, description: 'Case-insensitive substring on the captured request URL.' },
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
      const picked = candidates.at(-1)
      if (!picked?.requestId) {
        return failureResult(
          candidates.length
            ? 'Matched requests lack captured body ids. Retry with a narrower url_contains or wait for idle.'
            : `No captured request matched url_contains ${JSON.stringify(stringArg(input, 'url_contains'))}. Check resource_type or the substring.`
        )
      }
      const response = await cdpHost.responseBody(activeTabId, picked.requestId, picked.sessionId ?? undefined) as Record<string, unknown>
      const text = typeof response.text === 'string' ? response.text : null
      if (!text) return failureResult('The matched request has no text body to project.')
      let json: unknown
      try { json = JSON.parse(text) } catch { return failureResult('The matched body is not valid JSON; use protocol body for raw text.') }
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
        tabId: activeTabId,
        url: navigation.ready.url,
        title: navigation.ready.title,
        capturing: listed.capturing ?? true,
        matchedRequest: {
          url: picked.url,
          method: picked.method,
          type: picked.type,
          status: picked.status,
          requestId: picked.requestId,
          sessionId: picked.sessionId ?? null
        },
        ...metadata,
        json: projected.value,
        matched: projected.matched,
        limited: projected.limited
      })
    }
  })
}
