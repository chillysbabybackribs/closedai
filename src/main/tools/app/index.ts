import { defineActionTool, type ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { booleanArg, defineTool, numberArg, stringArg, type JsonObject, type ToolDefinition, type ToolNamespace } from '../tool.js'
import { requireApp, type AppHostProvider } from './host.js'

const selectorField: JsonObject = {
  type: 'string', minLength: 1, maxLength: 1_000,
  description: 'CSS selector targeting the element.'
}

const refField: JsonObject = {
  type: 'string', minLength: 1,
  description: 'Element ref or identifier.'
}

const xField: JsonObject = {
  type: 'number', minimum: 0,
  description: 'Horizontal CSS-pixel coordinate from the viewport left edge.'
}

const yField: JsonObject = {
  type: 'number', minimum: 0,
  description: 'Vertical CSS-pixel coordinate from the viewport top edge.'
}

const modifiersField: JsonObject = {
  type: 'array',
  items: { type: 'string', enum: ['alt', 'ctrl', 'meta', 'shift'] },
  description: 'Modifier keys held while the key is pressed.'
}

export function appTools(app: AppHostProvider): ToolNamespace {
  return {
    name: 'closedai_app',
    description: 'Inspection and interaction for the ClosedAI desktop app renderer.',
    tools: [inspectTool(app), defineActionTool({
      name: 'page',
      description:
        'Operate ClosedAI app chrome with real input. This targets the chat pane, tool dialogs, browser chrome, ' +
        'and other renderer UI; use browser_cdp.page for the web page inside the embedded browser. Use ' +
        'closedai_app.inspect for structured app state and closedai_ui.capture for visual inspection.',
      actions: actions(app)
    })]
  }
}

function inspectTool(app: AppHostProvider): ToolDefinition {
  return defineTool({
    name: 'inspect',
    description:
      'Read the current ClosedAI renderer state without changing it. Returns bounded window and document state, ' +
      'visible text, surfaces, focus, and interactive elements with refs, accessible names, text, state, and bounds. ' +
      'Use the refs with closedai_app.page actions; they become stale after another inspection or a layout change.',
    inputSchema: objectSchema({
      max_elements: {
        type: 'integer', minimum: 1, maximum: 500,
        description: 'Maximum visible interactive elements to return; defaults to 120.'
      }
    }),
    run: async (input) => jsonResult(await requireApp(app).inspect(numberArg(input, 'max_elements', 120)))
  })
}

function optionalNumberArg(input: JsonObject, key: string): number | undefined {
  const value = input[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`\`${key}\` must be a number`)
  return value
}

function actions(app: AppHostProvider): ToolAction[] {
  return [
    {
      action: 'click',
      description: 'Click an element by CSS selector, explicit viewport coordinates (x, y), or ref.',
      inputSchema: objectSchema({
        selector: selectorField,
        x: xField,
        y: yField,
        ref: refField
      }),
      run: async (input) => {
        const selector = stringArg(input, 'selector')
        const ref = stringArg(input, 'ref')
        const x = optionalNumberArg(input, 'x')
        const y = optionalNumberArg(input, 'y')
        if (!selector && !ref && (x === undefined || y === undefined)) {
          throw new Error('Pass `selector`, `(x, y)` coordinates, or `ref` to click')
        }
        return jsonResult(await requireApp(app).click({ selector, ref, x, y }))
      }
    },
    {
      action: 'type',
      description: 'Focus an input, textarea, or contenteditable element by selector or ref and insert text.',
      inputSchema: objectSchema({
        selector: selectorField,
        ref: refField,
        text: { type: 'string', maxLength: 20_000, description: 'Literal text to insert.' },
        clear: { type: 'boolean', description: 'Replace the current value (default true); false inserts at the caret.' }
      }, ['text']),
      run: async (input) => {
        const selector = stringArg(input, 'selector')
        const ref = stringArg(input, 'ref')
        if (!selector && !ref) throw new Error('Pass `selector` or `ref` to type into')
        return jsonResult(await requireApp(app).typeText({
          selector, ref, text: stringArg(input, 'text')!, clear: booleanArg(input, 'clear', true)
        }))
      }
    },
    {
      action: 'press_key',
      description: 'Send one real key press to the focused app element, including navigation keys and shortcut chords.',
      inputSchema: objectSchema({
        key: {
          type: 'string', minLength: 1, maxLength: 20,
          description: 'A single character or Enter, Tab, Escape, Backspace, Delete, an arrow key, Home, End, PageUp, or PageDown.'
        },
        modifiers: modifiersField
      }, ['key']),
      run: async (input) => jsonResult(await requireApp(app).pressKey(
        stringArg(input, 'key')!, modifiersFrom(input)
      ))
    },
    {
      action: 'scroll',
      description: 'Scroll an element into view by selector or ref, or wheel-scroll the app viewport by CSS-pixel deltas.',
      inputSchema: objectSchema({
        selector: selectorField,
        ref: refField,
        delta_x: { type: 'number', minimum: -10_000, maximum: 10_000, description: 'Horizontal wheel delta.' },
        delta_y: { type: 'number', minimum: -10_000, maximum: 10_000, description: 'Vertical wheel delta.' }
      }),
      run: async (input) => jsonResult(await requireApp(app).scroll({
        selector: stringArg(input, 'selector'),
        ref: stringArg(input, 'ref'),
        deltaX: numberArg(input, 'delta_x', 0),
        deltaY: numberArg(input, 'delta_y', 0)
      }))
    },
    {
      action: 'wait_for',
      description:
        'Wait until a CSS selector and/or visible app text is visible or hidden. When both are supplied, both must reach the requested condition.',
      inputSchema: objectSchema({
        selector: selectorField,
        wait_for_text: { type: 'string', minLength: 1, maxLength: 2_000, description: 'Visible text substring to observe.' },
        condition: {
          type: 'string', enum: ['visible', 'hidden'],
          description: 'Desired state; defaults to visible.'
        },
        timeout_ms: {
          type: 'integer', minimum: 0, maximum: 25_000,
          description: 'Maximum wait; defaults to 3000 ms.'
        }
      }),
      timeoutMs: 30_000,
      run: async (input, context) => {
        const selector = stringArg(input, 'selector')
        const text = stringArg(input, 'wait_for_text')
        if (!selector && !text) throw new Error('Pass `selector`, `wait_for_text`, or both')
        const condition = stringArg(input, 'condition', 'visible')
        if (condition !== 'visible' && condition !== 'hidden') throw new Error('Unsupported condition')
        const result = await requireApp(app).waitFor({
          selector, text, condition, timeoutMs: numberArg(input, 'timeout_ms', 3_000)
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

function modifiersFrom(input: JsonObject): string[] {
  const value = input.modifiers
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error('`modifiers` must be an array of strings')
  }
  return value as string[]
}

export type {
  AppClickTarget,
  AppElementMatch,
  AppHostProvider,
  AppScrollTarget,
  AppToolHost,
  AppTypeTarget,
  AppWaitOptions,
  AppWaitResult
} from './host.js'
