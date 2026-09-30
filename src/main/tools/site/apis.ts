import type { ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { failureResult, numberArg, stringArg } from '../tool.js'
import { requireCdp, type CdpHostProvider } from '../cdp/host.js'
import { DISCOVER_TAB_ID_FIELD, DISCOVER_URL_FIELD } from './discover-fields.js'
import { originOf } from './discover-probes.js'
import { buildApiMap } from './apis-map.js'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 80
const RECORDING_SAMPLE_LIMIT = 100

export function apisAction(cdp: CdpHostProvider): ToolAction {
  return {
    action: 'apis',
    description:
      'Read-only endpoint map from browser_cdp.instrument recordings on a tab (fetch, XHR, WebSocket). ' +
      'Requires hook before navigation/interaction. Does not install hooks itself.',
    inputSchema: objectSchema({
      tab_id: DISCOVER_TAB_ID_FIELD,
      url: DISCOVER_URL_FIELD,
      origin_only: {
        type: 'boolean',
        description: 'When true, list only endpoints whose resolved URL shares the seed origin (from url when set, else the tab recording url).'
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIMIT,
        description: `Max distinct endpoints returned; default ${DEFAULT_LIMIT}.`
      }
    }, ['tab_id']),
    timeoutMs: 15_000,
    run: async (input) => {
      const tabId = stringArg(input, 'tab_id')!
      const limit = numberArg(input, 'limit', DEFAULT_LIMIT)
      const originOnly = input.origin_only === true
      const seedUrl = stringArg(input, 'url')
      let pageOrigin: string | null = null
      if (seedUrl) {
        try {
          pageOrigin = originOf(new URL(seedUrl).toString())
        } catch {
          return failureResult('url must be an absolute http(s) URL when provided.')
        }
      }
      const host = requireCdp(cdp)
      const raw = await host.instrument(tabId, 'recording', {
        channels: [],
        capacity: 500,
        limit: RECORDING_SAMPLE_LIMIT
      })
      const payload = raw as { url?: string }
      if (!pageOrigin && typeof payload.url === 'string') {
        try {
          pageOrigin = originOf(payload.url)
        } catch {
          pageOrigin = null
        }
      }
      const map = buildApiMap(raw, { pageOrigin, originOnly, limit })
      return jsonResult({ tabId, ...map })
    }
  }
}
