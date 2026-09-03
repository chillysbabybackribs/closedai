import type { ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { booleanArg, numberArg, stringArg, type JsonObject } from '../tool.js'
import { UI_SURFACES } from '../../../shared/ui-controls.js'
import { requireHost, type AppUiHost, type AppUiTarget, type AppWaitCondition } from './host.js'

const targetFields: Record<string, JsonObject> = {
  control: { type: 'string', minLength: 1, maxLength: 80, description: 'Manifest control id, for example composer.send or drawer.row.' },
  item: { type: 'string', minLength: 1, maxLength: 200, description: 'The item value from controls when the control repeats (row id, tab id, model id).' },
  match: { type: 'string', minLength: 1, maxLength: 200, description: 'Case-insensitive substring of the control name, when the item is unknown.' },
  selector: { type: 'string', minLength: 1, maxLength: 1_000, description: 'Raw CSS selector; only when no manifest control fits.' }
}

const modifiersField: JsonObject = {
  type: 'array',
  items: { type: 'string', enum: ['alt', 'ctrl', 'meta', 'shift'] },
  description: 'Modifier keys held while the key is pressed.'
}

/** Control-level interaction with the renderer for when the UI itself is under test. */
export function appUiActions(ui: () => AppUiHost | null): ToolAction[] {
  return [
    {
      action: 'controls',
      description:
        'List rendered manifest controls: id, item, name, role, surface, and state (disabled, checked, selected, ' +
        'expanded, pressed, current, value). Scope by surface and/or query; no bounds or refs are returned because ' +
        'actions resolve controls by id at click time.',
      inputSchema: objectSchema({
        surface: { type: 'string', enum: [...UI_SURFACES], description: 'Only controls inside this surface; overlay means dialogs and menus.' },
        query: { type: 'string', minLength: 1, maxLength: 200, description: 'Case-insensitive filter over id, item, name, and value.' },
        max_controls: { type: 'integer', minimum: 1, maximum: 200, description: 'Default 60.' }
      }),
      run: async (input) => jsonResult(await requireHost(ui, 'app automation').controls({
        surface: stringArg(input, 'surface'),
        query: stringArg(input, 'query'),
        maxControls: numberArg(input, 'max_controls', 60)
      }))
    },
    {
      action: 'click',
      description: 'Click a control (control + item/match), a selector, or explicit viewport coordinates with real input. Disabled or covered targets fail without clicking.',
      inputSchema: objectSchema({
        ...targetFields,
        x: { type: 'number', minimum: 0, description: 'Viewport CSS x, with y.' },
        y: { type: 'number', minimum: 0, description: 'Viewport CSS y, with x.' }
      }),
      run: async (input) => {
        const target = targetFrom(input)
        const x = optionalNumber(input, 'x')
        const y = optionalNumber(input, 'y')
        if (!hasTarget(target) && (x === undefined || y === undefined)) throw new Error('Pass control, selector, or (x, y) to click')
        return jsonResult(await requireHost(ui, 'app automation').click({ ...target, x, y }))
      }
    },
    {
      action: 'type',
      description: 'Focus an input, textarea, or contenteditable control and insert text in one call; echoes the resulting value.',
      inputSchema: objectSchema({
        ...targetFields,
        text: { type: 'string', maxLength: 20_000, description: 'Literal text to insert.' },
        clear: { type: 'boolean', description: 'Replace the current value (default true); false inserts at the caret.' }
      }, ['text']),
      run: async (input) => {
        const target = targetFrom(input)
        if (!hasTarget(target)) throw new Error('Pass control or selector to type into')
        return jsonResult(await requireHost(ui, 'app automation').typeText({
          ...target, text: stringArg(input, 'text')!, clear: booleanArg(input, 'clear', true)
        }))
      }
    },
    {
      action: 'press_key',
      description: 'Send one real key press to the focused app element: Enter, Escape, Tab, arrows, or a chord such as ctrl+n.',
      inputSchema: objectSchema({
        key: { type: 'string', minLength: 1, maxLength: 20, description: 'A single character or Enter, Tab, Escape, Backspace, Delete, an arrow key, Home, End, PageUp, or PageDown.' },
        modifiers: modifiersField
      }, ['key']),
      run: async (input) => jsonResult(await requireHost(ui, 'app automation').pressKey(
        stringArg(input, 'key')!, modifiersFrom(input)
      ))
    },
    {
      action: 'scroll',
      description: 'Scroll a control into view, or wheel-scroll the app viewport by CSS-pixel deltas.',
      inputSchema: objectSchema({
        ...targetFields,
        delta_x: { type: 'number', minimum: -10_000, maximum: 10_000 },
        delta_y: { type: 'number', minimum: -10_000, maximum: 10_000 }
      }),
      run: async (input) => jsonResult(await requireHost(ui, 'app automation').scroll({
        ...targetFrom(input), deltaX: numberArg(input, 'delta_x', 0), deltaY: numberArg(input, 'delta_y', 0)
      }))
    },
    {
      action: 'wait_for',
      description:
        'Wait until a control is visible, hidden, enabled, or disabled, and/or until visible text appears or ' +
        'disappears. Prefer closedai_app.command with await_turn over polling for a turn to finish.',
      inputSchema: objectSchema({
        ...targetFields,
        wait_for_text: { type: 'string', minLength: 1, maxLength: 2_000, description: 'Visible text substring to observe.' },
        condition: { type: 'string', enum: ['visible', 'hidden', 'enabled', 'disabled'], description: 'Default visible.' },
        timeout_ms: { type: 'integer', minimum: 0, maximum: 25_000, description: 'Default 3000.' }
      }),
      timeoutMs: 30_000,
      run: async (input, context) => {
        const target = targetFrom(input)
        const text = stringArg(input, 'wait_for_text')
        const condition = stringArg(input, 'condition', 'visible') as AppWaitCondition
        if (!hasTarget(target) && !text) throw new Error('Pass control, selector, wait_for_text, or a combination')
        if ((condition === 'enabled' || condition === 'disabled') && !hasTarget(target)) {
          throw new Error(`condition ${condition} needs a control or selector`)
        }
        const result = await requireHost(ui, 'app automation').waitFor({
          ...target, text, condition, timeoutMs: numberArg(input, 'timeout_ms', 3_000)
        }, context.signal)
        const output = jsonResult(result)
        if (!result.reached) {
          output.isError = true
          output.errorKind = 'timeout'
        }
        return output
      }
    }
  ]
}

function targetFrom(input: JsonObject): AppUiTarget {
  return {
    control: stringArg(input, 'control'),
    item: stringArg(input, 'item'),
    match: stringArg(input, 'match'),
    selector: stringArg(input, 'selector')
  }
}

function hasTarget(target: AppUiTarget): boolean {
  return Boolean(target.control || target.selector)
}

function optionalNumber(input: JsonObject, key: string): number | undefined {
  const value = input[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`\`${key}\` must be a number`)
  return value
}

function modifiersFrom(input: JsonObject): string[] {
  const value = input.modifiers
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error('`modifiers` must be an array of strings')
  }
  return value as string[]
}
