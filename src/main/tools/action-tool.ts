import { suggestMatch, validateInput } from './schema.js'
import {
  usageResult,
  type JsonObject,
  type ToolContext,
  type ToolDefinition,
  type ToolResult
} from './tool.js'

// An action tool is one tool to the model and many files to us. Each action is a verb with
// its own description section, its own input schema, and its own run function; the helper
// assembles them into a single ToolDefinition whose `action` field selects the verb.
// Validation at call time is against the chosen action's schema, not the union, so the
// model gets precise errors even though the advertised schema is flat.

export type ToolAction = {
  /** snake_case verb the model passes as `action`. */
  action: string
  /** This action's section of the tool description: what it does and what it returns. */
  description: string
  /** JSON Schema for this action's own fields (`type: object`; must not define `action`). */
  inputSchema: JsonObject
  timeoutMs?: number
  run: (input: JsonObject, context: ToolContext) => Promise<ToolResult>
}

export type ActionToolOptions = {
  name: string
  /** Preamble: the domain, when to reach for this tool, anything shared by every action. */
  description: string
  actions: ToolAction[]
  deferLoading?: boolean
  /** Guard against the tool growing past what a model reads reliably. Default 8. */
  maxActions?: number
}

export const DEFAULT_MAX_ACTIONS = 8
const NAME = /^[a-z][a-z0-9_]*$/

export function defineActionTool(options: ActionToolOptions): ToolDefinition {
  const { name, actions } = options
  assertActionsWellFormed(name, actions, options.maxActions ?? DEFAULT_MAX_ACTIONS)
  const byVerb = new Map(actions.map((action) => [action.action, action]))
  const verbs = actions.map((action) => action.action)
  const timeouts = actions.map((action) => action.timeoutMs).filter((value): value is number => typeof value === 'number')

  return {
    name,
    description: assembleDescription(options.description, actions),
    inputSchema: assembleSchema(name, actions),
    deferLoading: options.deferLoading,
    timeoutMs: timeouts.length ? Math.max(...timeouts) : undefined,
    actions: actions.map((action) => ({ name: action.action, description: action.description, inputSchema: action.inputSchema })),
    restrictActions(enabledActions) {
      const kept = actions.filter((action) => enabledActions.includes(action.action))
      if (kept.length === 0) return null
      return kept.length === actions.length ? this : defineActionTool({ ...options, actions: kept })
    },
    async run(input, context) {
      const verb = input.action
      const action = typeof verb === 'string' ? byVerb.get(verb) : undefined
      if (!action) {
        const shown = typeof verb === 'string' ? `"${verb}"` : 'missing'
        const suggestion = typeof verb === 'string' ? suggestMatch(verb, verbs) : null
        const hint = suggestion ? ` (did you mean "${suggestion}"?)` : ''
        return usageResult(`${name}: action ${shown} is not one of ${verbs.join(', ')}${hint}`)
      }
      const { action: _omit, ...fields } = input
      const problems = validateInput(action.inputSchema, fields)
      if (problems.length) return usageResult(`${name}.${verb}: invalid arguments — ${problems.join('; ')}`)
      return action.run(fields, context)
    }
  }
}

function assembleDescription(preamble: string, actions: ToolAction[]): string {
  const sections = actions.map((action) => `- \`${action.action}\`: ${action.description.trim()}`)
  return `${preamble.trim()}\n\n${sections.join('\n')}`
}

/**
 * The advertised schema is flat: `action` plus the union of every action's properties.
 * A property shared by two actions must have an identical schema; otherwise it's a design
 * smell (same name, different meaning) and we refuse at startup instead of confusing the model.
 */
function assembleSchema(name: string, actions: ToolAction[]): JsonObject {
  const properties: Record<string, JsonObject> = {
    action: {
      type: 'string',
      enum: actions.map((action) => action.action),
      description: 'Which operation to perform.'
    }
  }
  const usedBy = new Map<string, string[]>()
  const sources = new Map<string, JsonObject>()
  for (const action of actions) {
    const own = recordOf(action.inputSchema.properties) ?? {}
    for (const [key, raw] of Object.entries(own)) {
      const schema = recordOf(raw)
      if (!schema) continue
      const previous = sources.get(key)
      if (previous && JSON.stringify(previous) !== JSON.stringify(schema)) {
        throw new Error(`Action tool "${name}": field "${key}" has different schemas across actions`)
      }
      sources.set(key, schema)
      usedBy.set(key, [...(usedBy.get(key) ?? []), action.action])
    }
  }
  for (const [key, schema] of sources) {
    const requiredBy = actions
      .filter((action) => Array.isArray(action.inputSchema.required) && action.inputSchema.required.includes(key))
      .map((action) => action.action)
    const note = requiredBy.length ? ` Required for: ${requiredBy.join(', ')}.` : ''
    const base = typeof schema.description === 'string' ? schema.description.trim() : ''
    properties[key] = { ...schema, description: base ? `${base}${note}` : note.trim() || undefined }
  }
  return { type: 'object', properties, required: ['action'] }
}

function assertActionsWellFormed(name: string, actions: ToolAction[], maxActions: number): void {
  if (actions.length === 0) throw new Error(`Action tool "${name}" needs at least one action`)
  if (actions.length > maxActions) {
    throw new Error(`Action tool "${name}" has ${actions.length} actions; the limit is ${maxActions}. Split it by result shape or trust level.`)
  }
  const seen = new Set<string>()
  for (const action of actions) {
    const label = `${name}.${action.action}`
    if (!NAME.test(action.action)) throw new Error(`Action "${label}" must be snake_case`)
    if (seen.has(action.action)) throw new Error(`Duplicate action "${label}"`)
    seen.add(action.action)
    if (!action.description.trim()) throw new Error(`Action "${label}" needs a description`)
    if (action.inputSchema.type !== 'object') throw new Error(`Action "${label}" inputSchema must have type "object"`)
    if (recordOf(action.inputSchema.properties)?.action) throw new Error(`Action "${label}" must not define an "action" field`)
  }
}

function recordOf(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}
