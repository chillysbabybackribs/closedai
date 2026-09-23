import { defineActionTool, type ToolAction } from '../action-tool.js'
import {
  booleanArg,
  numberArg,
  REAL_INPUT_FALLBACK_FIELD,
  requireRealInputFallback,
  stringArg,
  type JsonObject,
  type ToolDefinition
} from '../tool.js'
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
    deferLoading: true,
    description:
      'Semantic inspection and last-resort real input over CDP. Try deterministic browser/app APIs or non-input ' +
      'protocol commands first. click, click_at, type, press_key, and dismiss_overlay require fallback_reason ' +
      'and a batch with inspection and verification. Coordinates are main-viewport CSS pixels and may go stale ' +
      'after layout changes. Any input action brings its tab to the front and reports activatedTab when it ' +
      'switches; inspect_page alone reads a background tab. Results are JSON text; parse in exec.',
    actions: pageActions(cdp)
  })
}

function pageActions(cdp: CdpHostProvider): ToolAction[] {
  return [
    {
      action: 'inspect_page',
      description:
        'Return visible interactive elements with semantic names, stable snapshot refs, bounds, centers, quads, ' +
        'frame ids, hit-test state, and explicitly labelled main-viewport CSS coordinates. Reads a background ' +
        'tab without foregrounding it.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        max_elements: {
          type: 'integer', minimum: 1, maximum: 500,
          description: 'Maximum elements across all inspected frames; defaults to 50.'
        }
      }),
      run: async (input) => jsonResult(await requireCdp(cdp).inspectPage(
        tabIdFrom(input), numberArg(input, 'max_elements', 50)
      ))
    },
    {
      action: 'click',
      description:
        'Re-resolve a ref from the latest inspection, scroll it into view, verify its center is unobscured, ' +
        'then send a real CDP mouse click. Stale, detached, disabled, or covered refs fail without clicking.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        ref: refField,
        fallback_reason: REAL_INPUT_FALLBACK_FIELD
      }, ['ref', 'fallback_reason']),
      run: async (input, context) => {
        requireRealInputFallback(input, context)
        return jsonResult(await requireCdp(cdp).clickElement(tabIdFrom(input), stringArg(input, 'ref')!))
      }
    },
    {
      action: 'click_at',
      description:
        'Last-resort coordinate fallback: hit-test and click an explicit point in the main frame viewport. Prefer a ref.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        x: { type: 'number', minimum: 0, description: 'Horizontal CSS-pixel coordinate from the viewport left edge.' },
        y: { type: 'number', minimum: 0, description: 'Vertical CSS-pixel coordinate from the viewport top edge.' },
        coordinate_space: coordinateSpaceField,
        fallback_reason: REAL_INPUT_FALLBACK_FIELD
      }, ['x', 'y', 'fallback_reason']),
      run: async (input, context) => {
        requireRealInputFallback(input, context)
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
        'Click a ref to focus it, then insert text. ' +
        'Replaces the existing value by default; the result echoes the field value so no re-inspection is needed. ' +
        'Works on inputs, textareas, and contenteditable elements.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        ref: refField,
        text: {
          type: 'string', maxLength: 20_000,
          description: 'The literal text to insert. An empty string with clear left on erases the field.'
        },
        clear: { type: 'boolean', description: 'Replace the existing value (default true). Pass false to insert at the caret instead.' },
        fallback_reason: REAL_INPUT_FALLBACK_FIELD
      }, ['ref', 'text', 'fallback_reason']),
      run: async (input, context) => {
        requireRealInputFallback(input, context)
        return jsonResult(await requireCdp(cdp).typeText(
          tabIdFrom(input), stringArg(input, 'ref')!, stringArg(input, 'text')!, booleanArg(input, 'clear', true)
        ))
      }
    },
    {
      action: 'press_key',
      description:
        'Send keyDown+keyUp with optional modifiers — for Enter to submit, ' +
        'Escape to dismiss, Tab, arrows, or shortcut chords like ctrl+a. For text entry use type instead.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        key: {
          type: 'string', minLength: 1, maxLength: 20,
          description: 'A single character, or a named key: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown.'
        },
        modifiers: modifiersField,
        fallback_reason: REAL_INPUT_FALLBACK_FIELD
      }, ['key', 'fallback_reason']),
      run: async (input, context) => {
        requireRealInputFallback(input, context)
        return jsonResult(await requireCdp(cdp).pressKey(
          tabIdFrom(input), stringArg(input, 'key')!, modifiersFrom(input)
        ))
      }
    },
    {
      action: 'scroll',
      description:
        'Scroll a ref into view (pass ref), or wheel-scroll the main viewport by delta_x/delta_y CSS pixels ' +
        '(positive scrolls right/down). Re-inspect after scrolling because coordinates and refs may be stale.',
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
    },
    {
      action: 'dismiss_overlay',
      description:
        'Detect and dismiss a blocking modal, dialog, or cookie banner on this chat’s targeted tab. Tries consent accept, ' +
        'Escape, semantic close controls, then a pointer click on the close control, verifying dismissal after each step.',
      inputSchema: objectSchema({
        tab_id: tabIdField,
        kind: {
          type: 'string',
          enum: ['auto', 'modal', 'dialog', 'popover'],
          description: 'Overlay kind to target; auto considers every kind.'
        },
        verify_timeout_ms: {
          type: 'integer', minimum: 100, maximum: 2_000,
          description: 'Milliseconds to wait for dismissal verification after each strategy.'
        },
        fallback_reason: REAL_INPUT_FALLBACK_FIELD
      }, ['fallback_reason']),
      run: async (input, context) => {
        requireRealInputFallback(input, context)
        return jsonResult(await requireCdp(cdp).dismissOverlay(
          tabIdFrom(input),
          stringArg(input, 'kind', 'auto') ?? 'auto',
          numberArg(input, 'verify_timeout_ms', 600)
        ))
      }
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
