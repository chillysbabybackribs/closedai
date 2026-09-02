import { defineActionTool, type ToolAction } from '../action-tool.js'
import { numberArg, stringArg, type JsonObject, type ToolDefinition } from '../tool.js'
import { tabIdField, tabIdFrom } from './fields.js'
import { requireCdp, type CdpHostProvider } from './host.js'
import { jsonResult, objectSchema } from './result.js'

const coordinateSpaceField: JsonObject = {
  type: 'string',
  enum: ['main_viewport_css'],
  description: 'Coordinate system. CDP input uses CSS pixels relative to the main frame viewport.'
}

export function cdpPageTool(cdp: CdpHostProvider): ToolDefinition {
  return defineActionTool({
    name: 'page',
    description:
      'Agent-friendly page geometry and real mouse input over CDP. Inspect before clicking an element ref. ' +
      'Coordinates are snapshot-time CSS pixels in the main frame viewport and can become stale after any layout change.',
    actions: pageActions(cdp)
  })
}

function pageActions(cdp: CdpHostProvider): ToolAction[] {
  return [
    {
      action: 'inspect_page',
      description:
        'Return visible interactive elements with semantic names, stable snapshot refs, bounds, centers, quads, ' +
        'frame ids, hit-test state, and explicitly labelled main-viewport CSS coordinates.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        max_elements: {
          type: 'integer', minimum: 1, maximum: 500,
          description: 'Maximum elements across all inspected frames; defaults to 200.'
        }
      }),
      run: async (input) => jsonResult(await requireCdp(cdp).inspectPage(
        tabIdFrom(input), numberArg(input, 'max_elements', 200)
      ))
    },
    {
      action: 'click',
      description:
        'Re-resolve a ref from the latest inspection, scroll it into view, verify its center is unobscured, ' +
        'then send a real CDP mouse click. Stale, detached, disabled, or covered refs fail without clicking.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        ref: { type: 'string', minLength: 1, description: 'Element ref returned by the latest inspect_page call.' }
      }, ['ref']),
      run: async (input) => jsonResult(await requireCdp(cdp).clickElement(
        tabIdFrom(input), stringArg(input, 'ref')!
      ))
    },
    {
      action: 'click_at',
      description:
        'Hit-test and click an explicit point in the main frame viewport. Prefer click with a ref when an element is known.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        x: { type: 'number', minimum: 0, description: 'Horizontal CSS-pixel coordinate from the viewport left edge.' },
        y: { type: 'number', minimum: 0, description: 'Vertical CSS-pixel coordinate from the viewport top edge.' },
        coordinate_space: coordinateSpaceField
      }, ['x', 'y']),
      run: async (input) => {
        const coordinateSpace = stringArg(input, 'coordinate_space', 'main_viewport_css')
        if (coordinateSpace !== 'main_viewport_css') throw new Error('Unsupported coordinate space')
        return jsonResult(await requireCdp(cdp).clickAt(
          tabIdFrom(input), numberArg(input, 'x', 0), numberArg(input, 'y', 0)
        ))
      }
    }
  ]
}
