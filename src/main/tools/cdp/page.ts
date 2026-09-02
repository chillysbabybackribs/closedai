import { defineActionTool, type ToolAction } from '../action-tool.js'
import { booleanArg, numberArg, stringArg, type JsonObject, type ToolDefinition } from '../tool.js'
import { refField, tabIdField, tabIdFrom } from './fields.js'
import { requireCdp, type CdpHostProvider } from './host.js'
import { jsonResult, objectSchema } from '../json-result.js'

const coordinateSpaceField: JsonObject = {
  type: 'string',
  enum: ['main_viewport_css'],
  description: 'Coordinate system. CDP input uses CSS pixels relative to the main frame viewport.'
}

const modifiersField: JsonObject = {
  type: 'array',
  items: { type: 'string', enum: ['alt', 'ctrl', 'meta', 'shift'] },
  description: 'Modifier keys held while the key is pressed.'
}

export function cdpPageTool(cdp: CdpHostProvider): ToolDefinition {
  return defineActionTool({
    name: 'page',
    description:
      'Real page interaction over CDP: inspect elements, then click, type, press keys, and scroll ' +
      'by ref. Always prefer these verbs over raw protocol commands — one type call replaces a whole ' +
      'keystroke sequence. Coordinates are snapshot-time CSS pixels in the main frame viewport and ' +
      'can become stale after any layout change.',
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
      inputSchema: objectSchema({ tab_id: tabIdField, ref: refField }, ['ref']),
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
    },
    {
      action: 'type',
      description:
        'Click a ref to focus it, then insert text in one call (never simulate keystrokes one by one). ' +
        'Replaces the existing value by default; the result echoes the field value so no re-inspection is needed. ' +
        'Works on inputs, textareas, and contenteditable elements.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        ref: refField,
        text: {
          type: 'string', maxLength: 20_000,
          description: 'The literal text to insert. An empty string with clear left on erases the field.'
        },
        clear: { type: 'boolean', description: 'Replace the existing value (default true). Pass false to insert at the caret instead.' }
      }, ['ref', 'text']),
      run: async (input) => jsonResult(await requireCdp(cdp).typeText(
        tabIdFrom(input), stringArg(input, 'ref')!, stringArg(input, 'text')!, booleanArg(input, 'clear', true)
      ))
    },
    {
      action: 'press_key',
      description:
        'Press one key as a real keyDown+keyUp pair, with optional modifiers — for Enter to submit, ' +
        'Escape to dismiss, Tab, arrows, or shortcut chords like ctrl+a. For text entry use type instead.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        key: {
          type: 'string', minLength: 1, maxLength: 20,
          description: 'A single character, or a named key: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown.'
        },
        modifiers: modifiersField
      }, ['key']),
      run: async (input) => jsonResult(await requireCdp(cdp).pressKey(
        tabIdFrom(input), stringArg(input, 'key')!, modifiersFrom(input)
      ))
    },
    {
      action: 'scroll',
      description:
        'Scroll a ref into view (pass ref), or wheel-scroll the main viewport by delta_x/delta_y CSS pixels ' +
        '(positive scrolls right/down). Re-inspect after scrolling: coordinates and refs may be stale.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        ref: refField,
        delta_x: { type: 'number', minimum: -10_000, maximum: 10_000, description: 'Horizontal wheel scroll in CSS pixels.' },
        delta_y: { type: 'number', minimum: -10_000, maximum: 10_000, description: 'Vertical wheel scroll in CSS pixels.' }
      }),
      run: async (input) => jsonResult(await requireCdp(cdp).scrollPage(
        tabIdFrom(input),
        stringArg(input, 'ref'),
        numberArg(input, 'delta_x', 0),
        numberArg(input, 'delta_y', 0)
      ))
    }
  ]
}

function modifiersFrom(input: JsonObject): string[] {
  const modifiers = input.modifiers
  if (modifiers === undefined || modifiers === null) return []
  if (!Array.isArray(modifiers) || modifiers.some((entry) => typeof entry !== 'string')) {
    throw new Error('`modifiers` must be an array of strings')
  }
  return modifiers as string[]
}
