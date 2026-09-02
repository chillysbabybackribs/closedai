import { defineActionTool, type ToolAction } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { booleanArg, numberArg, stringArg, type JsonObject, type ToolNamespace } from '../tool.js'
import { requireApp, type AppHostProvider } from './host.js'

const refField: JsonObject = {
  type: 'string', minLength: 1,
  description: 'Element ref returned by the latest inspect_app call.'
}

const modifiersField: JsonObject = {
  type: 'array',
  items: { type: 'string', enum: ['alt', 'ctrl', 'meta', 'shift'] },
  description: 'Modifier keys held while the key is pressed.'
}

export function appTools(app: AppHostProvider): ToolNamespace {
  return {
    name: 'closedai_app',
    description: 'Semantic inspection and interaction for the ClosedAI desktop app renderer.',
    tools: [defineActionTool({
      name: 'page',
      description:
        'Operate ClosedAI app chrome with real input. This targets the chat pane, tool dialogs, browser chrome, ' +
        'and other renderer UI; use browser_cdp.page for the web page inside the embedded browser. Inspect first ' +
        'and use returned refs: they become stale when the layout changes.',
      actions: actions(app)
    })]
  }
}

function actions(app: AppHostProvider): ToolAction[] {
  return [
    {
      action: 'inspect_app',
      description:
        'Return window state, visible app surfaces and alerts, focused element, and visible interactive elements with stable snapshot refs.',
      inputSchema: objectSchema({
        max_elements: {
          type: 'integer', minimum: 1, maximum: 500,
          description: 'Maximum interactive elements to return; defaults to 200.'
        }
      }),
      run: async (input) => jsonResult(await requireApp(app).inspect(numberArg(input, 'max_elements', 200)))
    },
    {
      action: 'click',
      description: 'Re-resolve an inspected ref, scroll it into view, verify it is unobscured and enabled, then send a real click.',
      inputSchema: objectSchema({ ref: refField }, ['ref']),
      run: async (input) => jsonResult(await requireApp(app).click(stringArg(input, 'ref')!))
    },
    {
      action: 'type',
      description: 'Focus an inspected input, textarea, or contenteditable element and insert the full text in one operation.',
      inputSchema: objectSchema({
        ref: refField,
        text: { type: 'string', maxLength: 20_000, description: 'Literal text to insert.' },
        clear: { type: 'boolean', description: 'Replace the current value (default true); false inserts at the caret.' }
      }, ['ref', 'text']),
      run: async (input) => jsonResult(await requireApp(app).typeText(
        stringArg(input, 'ref')!, stringArg(input, 'text')!, booleanArg(input, 'clear', true)
      ))
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
      description: 'Scroll an inspected ref into view, or wheel-scroll the app viewport by CSS-pixel deltas.',
      inputSchema: objectSchema({
        ref: refField,
        delta_x: { type: 'number', minimum: -10_000, maximum: 10_000, description: 'Horizontal wheel delta.' },
        delta_y: { type: 'number', minimum: -10_000, maximum: 10_000, description: 'Vertical wheel delta.' }
      }),
      run: async (input) => jsonResult(await requireApp(app).scroll(
        stringArg(input, 'ref'), numberArg(input, 'delta_x', 0), numberArg(input, 'delta_y', 0)
      ))
    },
    {
      action: 'wait_for',
      description:
        'Wait until a CSS selector and/or visible app text is visible or hidden. When both are supplied, both must reach the requested condition.',
      inputSchema: objectSchema({
        selector: { type: 'string', minLength: 1, maxLength: 1_000, description: 'CSS selector to observe.' },
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
        if (!result.reached) output.isError = true
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

export type { AppHostProvider, AppToolHost, AppWaitOptions, AppWaitResult } from './host.js'
