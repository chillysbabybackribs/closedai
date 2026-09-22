import type { PageReadiness } from '../../browser-page-ready.js'
import { numberArg, stringArg, type JsonObject } from '../tool.js'

// Field schemas shared by more than one action. defineActionTool requires a shared field
// to have an identical schema in every action, so they are defined once here.

export const DEFAULT_WAIT_MS = 3_000
export const MAX_WAIT_MS = 15_000
export const DEFAULT_MAX_CHARS = 20_000
export const MAX_CHARS = 100_000

export const tabIdField: JsonObject = {
  type: 'string',
  description: 'Tab id from navigate. Defaults to this chat’s assigned tab, independent of UI selection. Another chat’s assigned tab can be read, not acted in.'
}

export const selectorField: JsonObject = {
  type: 'string',
  minLength: 1,
  description: 'Standard CSS selector in the main frame. Playwright/jQuery forms (:has-text, :contains, :visible, text=, XPath) are rejected by the page; match on text with script query and text_contains.'
}

export const maxCharsField: JsonObject = {
  type: 'integer',
  minimum: 200,
  maximum: MAX_CHARS,
  description: `Text limit; default ${DEFAULT_MAX_CHARS}.`
}

export const urlField: JsonObject = {
  type: 'string',
  minLength: 1,
  description: 'Absolute URL or relative path. Not search text: navigate refuses free text and search-engine results pages — use search.query for discovery.'
}

export const waitUntilField: JsonObject = {
  type: 'string',
  enum: ['dom_ready', 'load', 'idle'],
  description: 'Load state: dom_ready (default), load, or idle (text stable).'
}

export const waitForSelectorField: JsonObject = {
  type: 'string',
  minLength: 1,
  description: 'Also wait until this CSS selector matches. Non-CSS forms fail immediately; see selector on read_page/navigate.'
}

export const waitForTextField: JsonObject = {
  type: 'string',
  minLength: 1,
  description: 'Also wait until the visible page text contains this string.'
}

export const timeoutMsField: JsonObject = {
  type: 'integer',
  minimum: 1_000,
  maximum: MAX_WAIT_MS,
  description: `Milliseconds to wait before giving up; default ${DEFAULT_WAIT_MS}. The result says whether the wait succeeded, and an unmet wait comes back as an error naming what was still missing.`
}

export const readinessProperties: Record<string, JsonObject> = {
  wait_until: waitUntilField,
  wait_for_selector: waitForSelectorField,
  wait_for_text: waitForTextField,
  timeout_ms: timeoutMsField
}

export function readinessFrom(input: JsonObject): PageReadiness {
  const until = stringArg(input, 'wait_until', 'dom_ready') as PageReadiness['until']
  return {
    until,
    selector: stringArg(input, 'wait_for_selector'),
    text: stringArg(input, 'wait_for_text'),
    timeoutMs: numberArg(input, 'timeout_ms', DEFAULT_WAIT_MS)
  }
}
