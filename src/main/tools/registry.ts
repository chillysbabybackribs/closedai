import type { ToolCallEvent } from '../../shared/tools.js'
import { validateInput } from './schema.js'
import { truncateText } from './truncate-json.js'
import {
  DEFAULT_TOOL_TIMEOUT_MS,
  failureResult,
  type JsonObject,
  type ToolContext,
  type ToolDefinition,
  type ToolNamespace,
  type ToolResult
} from './tool.js'
import { ToolResourceLocks } from './resource-locks.js'

export type ToolCallRequest = {
  namespace: string | null
  tool: string
  arguments: unknown
}

export type ToolCallContext = Omit<ToolContext, 'signal'>
export type ToolCallListener = (record: ToolCallEvent) => void

/** Full-fidelity view of one call for the turn trace: the request as made and the result as returned. */
export type ToolCallTrace =
  | { phase: 'start'; request: ToolCallRequest; context: ToolCallContext }
  | { phase: 'end'; request: ToolCallRequest; context: ToolCallContext; result: ToolResult; durationMs: number }
export type ToolCallObserver = (trace: ToolCallTrace) => void
// Tool results live in the thread history for every later turn. Code-mode models see a
// dynamic tool result only through `exec`, whose own result cap is 10k tokens (~40k chars)
// with a silent head/tail cut, so this ceiling sits well below it: ~6k tokens, and the model
// reads ClosedAI's advice instead of Codex's cut. JSON results shrink structurally so that a
// script's JSON.parse never throws on a truncated string.
export const MAX_RESULT_TEXT_CHARS = 24_000
const TRUNCATION_ADVICE = 'Narrow the request (a selector, range, filter, or smaller limit) to see the rest.'

const NAME = /^[a-z][a-z0-9_]*$/

/**
 * Every tool the app offers, in one place. Provider adapters read `namespaces` to
 * advertise tools and call `call()` to run one; the registry owns validation, timeouts,
 * and turning thrown errors into a result the model can read.
 */
export class ToolRegistry {
  readonly namespaces: readonly ToolNamespace[]
  private readonly listeners = new Set<ToolCallListener>()
  private readonly observers = new Set<ToolCallObserver>()
  private readonly disabled = new Set<string>()

  constructor(namespaces: ToolNamespace[], private readonly resourceLocks = new ToolResourceLocks()) {
    assertWellFormed(namespaces)
    this.namespaces = namespaces.map((namespace) => ({ ...namespace, tools: [...namespace.tools] }))
  }

  get isEmpty(): boolean {
    return this.namespaces.every((namespace) => namespace.tools.length === 0)
  }

  /** Flat `namespace.tool` names, for logs and the manifest test. */
  names(): string[] {
    return this.namespaces.flatMap((namespace) => namespace.tools.map((tool) => `${namespace.name}.${tool.name}`))
  }

  /** `namespace.tool` for a plain tool, `namespace.tool.action` for one verb of an action tool. */
  isEnabled(id: string): boolean {
    return !this.disabled.has(id)
  }

  /** Every switchable id: plain tools, and each action of an action tool. */
  switchableIds(): string[] {
    return this.namespaces.flatMap((namespace) => namespace.tools.flatMap((tool) => {
      const toolId = `${namespace.name}.${tool.name}`
      return tool.actions?.length ? tool.actions.map((action) => `${toolId}.${action.name}`) : [toolId]
    }))
  }

  /** Switch a tool or action off or on. Unknown ids are ignored. Returns the disabled ids. */
  setEnabled(id: string, enabled: boolean): string[] {
    if (!this.switchableIds().includes(id)) return this.disabledIds()
    if (enabled) this.disabled.delete(id)
    else this.disabled.add(id)
    return this.disabledIds()
  }

  disabledIds(): string[] {
    return [...this.disabled].sort()
  }

  /** Namespaces with only enabled tools and actions; what adapters should advertise. */
  enabledNamespaces(): ToolNamespace[] {
    return this.namespaces
      .map((namespace) => ({
        ...namespace,
        tools: namespace.tools.flatMap((tool) => {
          const restricted = this.restrict(namespace.name, tool)
          return restricted ? [restricted] : []
        })
      }))
      .filter((namespace) => namespace.tools.length > 0)
  }

  private restrict(namespaceName: string, tool: ToolDefinition): ToolDefinition | null {
    const toolId = `${namespaceName}.${tool.name}`
    if (!tool.actions?.length) return this.isEnabled(toolId) ? tool : null
    const enabled = tool.actions.filter((action) => this.isEnabled(`${toolId}.${action.name}`)).map((action) => action.name)
    if (enabled.length === tool.actions.length) return tool
    return tool.restrictActions ? tool.restrictActions(enabled) : enabled.length ? tool : null
  }

  /** Observe every call (telemetry). Listeners must not throw; errors are swallowed. */
  subscribe(listener: ToolCallListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Observe every call with its arguments and result (the turn trace). Observers must not throw. */
  observe(observer: ToolCallObserver): () => void {
    this.observers.add(observer)
    return () => { this.observers.delete(observer) }
  }

  find(namespace: string | null, tool: string): ToolDefinition | null {
    // A null namespace means the model called the bare tool name; accept it when unambiguous.
    const candidates = this.namespaces
      .filter((entry) => namespace === null || entry.name === namespace)
      .flatMap((entry) => entry.tools.filter((definition) => definition.name === tool))
    return candidates.length === 1 ? candidates[0] : null
  }

  async call(request: ToolCallRequest, context: ToolCallContext): Promise<ToolResult> {
    const startedAt = performance.now()
    this.notifyObservers({ phase: 'start', request, context })
    const result = await this.run(request, context)
    this.notifyObservers({ phase: 'end', request, context, result, durationMs: performance.now() - startedAt })
    this.report(request, result)
    return result
  }

  private notifyObservers(trace: ToolCallTrace): void {
    for (const observer of this.observers) {
      try { observer(trace) } catch { /* the trace must never break a call */ }
    }
  }

  private async run(request: ToolCallRequest, context: ToolCallContext): Promise<ToolResult> {
    const label = request.namespace ? `${request.namespace}.${request.tool}` : request.tool
    const definition = this.find(request.namespace, request.tool)
    if (!definition) return failureResult(`Unknown tool: ${label}`)
    const owner = this.namespaces.find((entry) => entry.tools.includes(definition))
    const toolId = owner ? `${owner.name}.${definition.name}` : label
    const input = request.arguments ?? {}
    const verb = definition.actions?.length && input && typeof input === 'object' && typeof (input as JsonObject).action === 'string'
      ? String((input as JsonObject).action)
      : null
    const switchId = verb ? `${toolId}.${verb}` : toolId
    if ((verb || !definition.actions?.length) && !this.isEnabled(switchId)) {
      return failureResult(`${verb ? `${label}.${verb}` : label} is switched off in ClosedAI's Tools panel; ask the user to enable it`)
    }

    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return failureResult(`${label}: arguments must be an object`)
    }
    const problems = validateInput(definition.inputSchema, input)
    if (problems.length) return failureResult(`${label}: invalid arguments — ${problems.join('; ')}`)

    const controller = new AbortController()
    const timeoutMs = definition.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
    let timer: NodeJS.Timeout | null = null
    const timeout = new Promise<ToolResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve(failureResult(`${label}: timed out after ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
    })
    const lock = this.resourceLocks.tryAcquire(request, input as JsonObject, context.paneId ?? null, context.callId)
    if (typeof lock === 'string') return failureResult(`${label}: conflict — ${lock}`)
    try {
      const run = Promise.resolve().then(() =>
        definition.run(input as JsonObject, { ...context, signal: controller.signal })
      )
      void run.then(lock, lock)
      return boundResult(await Promise.race([run, timeout]))
    } catch (error) {
      return failureResult(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private report(request: ToolCallRequest, result: ToolResult): void {
    if (this.listeners.size === 0) return
    const definition = this.find(request.namespace, request.tool)
    const namespace = request.namespace ?? this.namespaces.find((entry) => entry.tools.includes(definition!))?.name ?? null
    const args = request.arguments
    const action = args && typeof args === 'object' && typeof (args as JsonObject).action === 'string' ? String((args as JsonObject).action) : null
    const record: ToolCallEvent = {
      toolId: namespace ? `${namespace}.${request.tool}` : request.tool,
      action,
      ok: !result.isError
    }
    for (const listener of this.listeners) {
      try { listener(record) } catch { /* telemetry must never break a call */ }
    }
  }
}

/** Cap each text item so one call cannot permanently occupy a large slice of the context. */
export function boundResult(result: ToolResult, maxChars = MAX_RESULT_TEXT_CHARS): ToolResult {
  if (!result.content.some((item) => item.type === 'text' && item.text.length > maxChars)) return result
  return {
    ...result,
    content: result.content.map((item) => {
      if (item.type !== 'text' || item.text.length <= maxChars) return item
      return { type: 'text', text: truncateText(item.text, maxChars, TRUNCATION_ADVICE).text }
    })
  }
}

function assertWellFormed(namespaces: ToolNamespace[]): void {
  const seenNamespaces = new Set<string>()
  for (const namespace of namespaces) {
    if (!NAME.test(namespace.name)) throw new Error(`Tool namespace "${namespace.name}" must be snake_case`)
    if (seenNamespaces.has(namespace.name)) throw new Error(`Duplicate tool namespace "${namespace.name}"`)
    seenNamespaces.add(namespace.name)
    if (!namespace.description.trim()) throw new Error(`Tool namespace "${namespace.name}" needs a description`)
    const seenTools = new Set<string>()
    for (const tool of namespace.tools) {
      const label = `${namespace.name}.${tool.name}`
      if (!NAME.test(tool.name)) throw new Error(`Tool "${label}" must be snake_case`)
      if (seenTools.has(tool.name)) throw new Error(`Duplicate tool "${label}"`)
      seenTools.add(tool.name)
      if (!tool.description.trim()) throw new Error(`Tool "${label}" needs a description`)
      if (tool.inputSchema.type !== 'object') throw new Error(`Tool "${label}" inputSchema must have type "object"`)
    }
  }
}
