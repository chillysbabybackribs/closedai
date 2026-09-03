import { allSettledBounded } from '../../bounded-concurrency.js'
import { normalizeBatchMaxCalls } from '../../batch-config.js'
import type { ToolRegistry } from '../registry.js'
import {
  booleanArg,
  defineTool,
  failureResult,
  type JsonObject,
  type ToolContent,
  type ToolContext,
  type ToolNamespace,
  type ToolResult
} from '../tool.js'

// Namespace `tool_batch`: one first-class tool that runs several other tool calls in a
// single model turn. Every inner call is dispatched back through the ToolRegistry, so it
// keeps its own schema validation, on/off switch, timeout, and telemetry record — the
// batch adds sequencing and result assembly, never a second execution path.

export const TOOL_BATCH_NAMESPACE = 'tool_batch'
/** Independent calls overlap, but a runaway page cannot monopolise the browser host. */
const PARALLEL_WIDTH = 4
/** Must contain a full sequential batch of slow inner calls (navigate is ~20s worst case). */
const BATCH_TIMEOUT_MS = 180_000

export type ToolRegistryProvider = () => ToolRegistry

export type BatchToolOptions = {
  /** Resolved startup setting; invalid values fall back to the shared default. */
  maxCalls?: number
}

type BatchCall = {
  /** 1-based position, used as the label the model can correlate results by. */
  index: number
  namespace: string | null
  tool: string
  label: string
  arguments: JsonObject
  includeResult: boolean
}

type BatchOutcome =
  | { status: 'ran'; result: ToolResult }
  | { status: 'skipped'; reason: string }

/**
 * The registry is provided lazily because this namespace is constructed as part of the
 * very registry it dispatches into (same pattern as the browser host providers).
 */
export function batchTools(registry: ToolRegistryProvider, options: BatchToolOptions = {}): ToolNamespace {
  const maxCalls = normalizeBatchMaxCalls(options.maxCalls)
  return {
    name: TOOL_BATCH_NAMESPACE,
    description: 'Run several tool calls from the other namespaces in one request.',
    tools: [
      defineTool({
        name: 'run',
        description:
          'Run up to ' + maxCalls + ' tool calls in one request instead of a turn per call. ' +
          'Each entry names a tool as `namespace.tool` and carries the exact arguments a direct call would use; ' +
          'each call reports its own ok/failed status and results are returned in call order, numbered `[1]`, `[2]`, … ' +
          'By default the calls run in order and a failure skips the rest, so a dependent sequence ' +
          '(navigate, then wait_for, then read_page) is safe to batch. Set `parallel` to true only for ' +
          'independent read-only calls; they overlap, and one failure does not stop the others. ' +
          'Batches cannot nest. Prefer direct calls for single steps or when a result decides what to do next. ' +
          'For successful intermediate actions, set `include_result` false so only status—not a payload the model does not need—is returned; failures are always included. ' +
          'In exec scripts do not use this tool: await the tools directly (Promise.all for independent reads).',
        inputSchema: {
          type: 'object',
          properties: {
            calls: {
              type: 'array',
              description: `The tool calls to run, in order. Between 1 and ${maxCalls} entries.`,
              items: {
                type: 'object',
                properties: {
                  tool: {
                    type: 'string',
                    description: 'The tool to call, as `namespace.tool` (for example `embedded_browser.page`).'
                  },
                  arguments: {
                    type: 'object',
                    description: "That tool's arguments, exactly as for a direct call."
                  },
                  include_result: {
                    type: 'boolean',
                    description: 'False suppresses a successful intermediate result body and images; failures are always returned. Defaults to true.'
                  }
                },
                required: ['tool']
              }
            },
            parallel: {
              type: 'boolean',
              description:
                'true runs the calls concurrently and never skips one because another failed. ' +
                'Default false: calls run in order and a failure skips everything after it.'
            }
          },
          required: ['calls']
        },
        timeoutMs: BATCH_TIMEOUT_MS,
        async run(input, context) {
          const parsed = parseCalls(input, maxCalls)
          if (typeof parsed === 'string') return failureResult(`tool_batch.run: ${parsed}`)
          const outcomes = booleanArg(input, 'parallel', false)
            ? await runParallel(registry(), parsed, context)
            : await runSequential(registry(), parsed, context)
          return assembleResult(parsed, outcomes)
        }
      })
    ]
  }
}

/** The schema has already vetted shapes; this owns limits and target resolution. */
function parseCalls(input: JsonObject, maxCalls: number): BatchCall[] | string {
  const entries = input.calls as Array<Record<string, unknown>>
  if (entries.length === 0) return 'the batch needs at least one call'
  if (entries.length > maxCalls) {
    return `the batch has ${entries.length} calls; the limit is ${maxCalls}. Split it into smaller batches.`
  }
  const calls: BatchCall[] = []
  for (const [position, entry] of entries.entries()) {
    const label = String(entry.tool)
    const dot = label.indexOf('.')
    const namespace = dot > 0 ? label.slice(0, dot) : null
    const tool = dot > 0 ? label.slice(dot + 1) : label
    if (!tool) return `call ${position + 1}: "${label}" is not a tool name; use \`namespace.tool\``
    if (namespace === TOOL_BATCH_NAMESPACE || (namespace === null && tool === 'run')) {
      return `call ${position + 1}: batches cannot nest — list the inner calls directly`
    }
    calls.push({
      index: position + 1,
      namespace,
      tool,
      label,
      arguments: (entry.arguments ?? {}) as JsonObject,
      includeResult: entry.include_result !== false
    })
  }
  return calls
}

/** Inner calls share the batch's ids; the suffix keeps each telemetry record attributable. */
function dispatch(registry: ToolRegistry, call: BatchCall, context: ToolContext): Promise<ToolResult> {
  return registry.call(
    { namespace: call.namespace, tool: call.tool, arguments: call.arguments },
    {
      threadId: context.threadId,
      turnId: context.turnId,
      callId: `${context.callId}#${call.index}`,
      parentCallId: context.callId,
      batchId: context.callId,
      source: 'batch'
    }
  )
}

/**
 * In-order execution treats the batch as one plan: a failed step invalidates the steps
 * behind it (they usually depend on it), so they are reported as skipped rather than run
 * against a state the model did not intend.
 */
async function runSequential(registry: ToolRegistry, calls: BatchCall[], context: ToolContext): Promise<BatchOutcome[]> {
  const outcomes: BatchOutcome[] = []
  let skipReason: string | null = null
  for (const call of calls) {
    if (!skipReason && context.signal.aborted) skipReason = 'the batch timed out'
    if (skipReason) {
      outcomes.push({ status: 'skipped', reason: skipReason })
      continue
    }
    const result = await dispatch(registry, call, context)
    outcomes.push({ status: 'ran', result })
    if (result.isError) skipReason = `call [${call.index}] failed and the batch is sequential`
  }
  return outcomes
}

async function runParallel(registry: ToolRegistry, calls: BatchCall[], context: ToolContext): Promise<BatchOutcome[]> {
  const settled = await allSettledBounded(calls, PARALLEL_WIDTH, (call) => dispatch(registry, call, context))
  return settled.map((entry) => ({
    status: 'ran',
    // The registry converts tool errors to results; a rejection here is a registry bug,
    // but the model still deserves a readable per-call failure over a lost batch.
    result: entry.status === 'fulfilled'
      ? entry.value
      : failureResult(entry.reason instanceof Error ? entry.reason.message : String(entry.reason))
  }))
}

/**
 * One text item for the whole batch so the registry's per-item size cap bounds the batch
 * as a unit; images keep their fidelity as separate items appended in call order.
 */
function assembleResult(calls: BatchCall[], outcomes: BatchOutcome[]): ToolResult {
  const sections: string[] = []
  const images: ToolContent[] = []
  let succeeded = 0
  let skipped = 0
  outcomes.forEach((outcome, position) => {
    const call = calls[position]
    if (outcome.status === 'skipped') {
      skipped += 1
      sections.push(`[${call.index}] ${call.label} — skipped: ${outcome.reason}`)
      return
    }
    const { result } = outcome
    if (!result.isError) succeeded += 1
    const includeContent = call.includeResult || Boolean(result.isError)
    const text = includeContent ? result.content
      .flatMap((item) => (item.type === 'text' ? [item.text] : []))
      .join('\n') : ''
    const callImages = includeContent ? result.content.filter((item) => item.type === 'image') : []
    images.push(...callImages)
    const imageNote = callImages.length
      ? `\n(${callImages.length} image${callImages.length === 1 ? '' : 's'} attached below, in call order)`
      : ''
    const body = text || imageNote ? `\n${text}${imageNote}` : ''
    sections.push(`[${call.index}] ${call.label} — ${result.isError ? 'failed' : 'ok'}${body}`)
  })
  const summary = `${succeeded} of ${calls.length} calls succeeded${skipped ? ` (${skipped} skipped)` : ''}.`
  return {
    content: [{ type: 'text', text: `${summary}\n\n${sections.join('\n\n')}` }, ...images],
    // Partial success is success: the model needs the surviving results, not a retry loop.
    ...(succeeded === 0 ? { isError: true } : {})
  }
}
