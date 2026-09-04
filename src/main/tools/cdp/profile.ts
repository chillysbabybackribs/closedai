import { defineActionTool, type ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { numberArg, type JsonObject, type ToolDefinition } from '../tool.js'
import { tabIdField, tabIdFrom } from './fields.js'
import { requireCdp, type CdpHostProvider } from './host.js'

const DEFAULT_LIMIT = 15
const MAX_LIMIT = 60

const channelsField: JsonObject = {
  type: 'array',
  items: { type: 'string', enum: ['script', 'style', 'cpu', 'heap', 'all'] },
  maxItems: 5,
  description: 'What to record: script (JS byte coverage), style (CSS rule coverage), cpu (sampling profiler), heap (allocation sampling). Defaults to all.'
}

const limitField: JsonObject = {
  type: 'integer',
  minimum: 1,
  maximum: MAX_LIMIT,
  description: `Entries per ranked list; default ${DEFAULT_LIMIT}.`
}

function channelsFrom(input: JsonObject): string[] {
  const value = input.channels
  return Array.isArray(value) ? value.map(String) : []
}

export function cdpProfileTool(cdp: CdpHostProvider): ToolDefinition {
  return defineActionTool({
    name: 'profile',
    description:
      'Measure what a real page costs: unused JavaScript and CSS bytes, the functions holding the ' +
      'main thread, and the call sites allocating memory. Coverage and sampling must be armed before ' +
      'the code runs, so call start, then navigate or interact, then stop. The raw protocol payloads ' +
      'are far too large to return — a single precise-coverage take on an article page is ~950k ' +
      'characters — so every result here is folded in the main process into ranked totals. Use metrics ' +
      'on its own for a cheap snapshot of nodes, listeners, layout counts and heap size with nothing armed.',
    actions: actions(cdp)
  })
}

function actions(cdp: CdpHostProvider): ToolAction[] {
  return [
    {
      action: 'start',
      description:
        'Arm the requested recorders on a tab and return which started. Nothing is measured until this ' +
        'runs, so arm first and then cause the work you want measured.',
      inputSchema: objectSchema({ tab_id: tabIdField, channels: channelsField }),
      run: async (input) => jsonResult(await requireCdp(cdp).profile(tabIdFrom(input), 'start', {
        channels: channelsFrom(input),
        limit: numberArg(input, 'limit', DEFAULT_LIMIT)
      }))
    },
    {
      action: 'stop',
      description:
        'Stop the recorders armed by start and return the folded report: per-URL used/unused bytes for ' +
        'script and style coverage, per-function self time for cpu, per-site retained bytes for heap, ' +
        'plus page metrics. Entries are ranked worst-first and cut to limit. Heap sampling is re-armed ' +
        'on every main-frame commit, so a navigation between start and stop reports the new document; ' +
        'when a sampler is lost anyway the report says so in heapUnavailable instead of stalling.',
      inputSchema: objectSchema({ tab_id: tabIdField, channels: channelsField, limit: limitField }),
      run: async (input) => jsonResult(await requireCdp(cdp).profile(tabIdFrom(input), 'stop', {
        channels: channelsFrom(input),
        limit: numberArg(input, 'limit', DEFAULT_LIMIT)
      }))
    },
    {
      action: 'metrics',
      description:
        'Return the tab\'s current Performance metrics — documents, nodes, listeners, layout and style ' +
        'recalc counts and durations, script time, JS heap size, first paint — without arming anything.',
      inputSchema: objectSchema({ tab_id: tabIdField }),
      run: async (input) => jsonResult(await requireCdp(cdp).profile(tabIdFrom(input), 'metrics', {
        channels: [],
        limit: DEFAULT_LIMIT
      }))
    }
  ]
}
