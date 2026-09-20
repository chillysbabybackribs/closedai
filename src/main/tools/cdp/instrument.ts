import { defineActionTool, type ToolAction } from '../action-tool.js'
import { INSTRUMENT_CHANNELS, DEFAULT_CAPACITY } from '../../cdp/cdp-instrument.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { numberArg, type JsonObject, type ToolDefinition } from '../tool.js'
import { tabIdField, tabIdFrom } from './fields.js'
import { requireCdp, type CdpHostProvider } from './host.js'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100
const MAX_CAPACITY = 5_000

const channelsField: JsonObject = {
  type: 'array',
  items: { type: 'string', enum: [...INSTRUMENT_CHANNELS] },
  maxItems: INSTRUMENT_CHANNELS.length,
  description:
    'Which APIs to watch: fetch, xhr, websocket, cookie, storage, ' +
    'fingerprint (navigator/screen getters, canvas.toDataURL, WebGL getParameter, ' +
    'timezone offset), error. Defaults to all of them.'
}

function channelsFrom(input: JsonObject): string[] {
  const value = input.channels
  return Array.isArray(value) ? value.map(String) : []
}

export function cdpInstrumentTool(cdp: CdpHostProvider): ToolDefinition {
  return defineActionTool({
    name: 'instrument',
    deferLoading: true,
    description:
      'Watch what a page does from its very first instruction. The recorder is installed with ' +
      '`Page.addScriptToEvaluateOnNewDocument`, so it wraps fetch, XHR, WebSocket, document.cookie, ' +
      'storage and fingerprinting getters before the document scripts run, ' +
      'and it stays installed across navigations and redirects — which is the window ordinary page ' +
      'evaluation cannot see, because by then the work has already happened. Wrappers are observable ' +
      'and may affect page behavior; eval/Function are never wrapped. Inspect recording.patches for ' +
      'failed or unavailable APIs. Worker coverage is not implied. Counting happens in the page and only a ' +
      'bounded fold is returned. Pair it with embedded_browser.network when you also need the wire ' +
      'view: this reports the call the page made, that reports the request that left.',
    actions: actions(cdp)
  })
}

function actions(cdp: CdpHostProvider): ToolAction[] {
  return [
    {
      action: 'hook',
      description:
        'Install the recorder on the tab\'s next document and on the one already loaded. Navigate ' +
        'afterwards to capture a page from its first instruction; hooking alone captures only what ' +
        'the current document does from now on. Replaces the current recorder and resets its counts.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        channels: channelsField,
        capacity: {
          type: 'integer',
          minimum: 10,
          maximum: MAX_CAPACITY,
          description: `Ring-buffer size for retained events; default ${DEFAULT_CAPACITY}. Counters stay exact past it and the overflow is reported as dropped.`
        }
      }),
      run: async (input) => jsonResult(await requireCdp(cdp).instrument(tabIdFrom(input), 'hook', {
        channels: channelsFrom(input),
        capacity: numberArg(input, 'capacity', DEFAULT_CAPACITY),
        limit: DEFAULT_LIMIT
      }))
    },
    {
      action: 'recording',
      description:
        'Read the current document\'s recording: patch installation status, per-channel observed counts, the most frequent distinct ' +
        'calls, and the most recent ones with their millisecond offset from document start. Reports ' +
        'installed false when the document has no recorder — a navigation without a hook in place.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Entries per list; default ${DEFAULT_LIMIT}.` }
      }),
      run: async (input) => jsonResult(await requireCdp(cdp).instrument(tabIdFrom(input), 'recording', {
        channels: [],
        capacity: DEFAULT_CAPACITY,
        limit: numberArg(input, 'limit', DEFAULT_LIMIT)
      }))
    },
    {
      action: 'unhook',
      description:
        'Remove the recorder from future documents and disable current recording. Restore owned API ' +
        'descriptors and remove event listeners; preserve properties changed by the page and report ' +
        'restoration failures. Retained wrapper references stop recording. Other frame documents may require navigation.',
      inputSchema: objectSchema({ tab_id: tabIdField }),
      run: async (input) => jsonResult(await requireCdp(cdp).instrument(tabIdFrom(input), 'unhook', {
        channels: [],
        capacity: DEFAULT_CAPACITY,
        limit: DEFAULT_LIMIT
      }))
    }
  ]
}
