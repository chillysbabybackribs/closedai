import { allSettledBounded } from '../../bounded-concurrency.js'
import { normalizeBatchMaxCalls } from '../../batch-config.js'
import { compensationFor, releases, type Compensation } from './compensation.js'
import type { ToolRegistry } from '../registry.js'
import { resourceKey } from '../resource-locks.js'
import {
  booleanArg,
  defineTool,
  failureResult,
  usageResult,
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
          '(navigate, then wait_for, then read_page) is safe to batch. A sequential batch also unwinds ' +
          'itself: when a step fails, invisible browser state armed by earlier steps — profiling ' +
          'recorders, a pre-document hook, device emulation — is released again and the release is ' +
          'reported, so a broken plan does not leave a tab instrumented. Set `parallel` to true for ' +
          'independent work; explicit browser targets run in parallel while same-target work serializes. ' +
          'Batches cannot nest, and only ClosedAI tools are routable: the tools your own harness gives you ' +
          '(file read/search/edit, shell, web fetch) must be called directly, outside a batch. ' +
          'Use this when a known sequence or independent group benefits from batching; direct calls are fine. Real-input fallbacks must include their ' +
          'inspection and post-action verification in the same sequential batch. ' +
          'For successful intermediate actions, set `include_result` false so only status—not a payload the model does not need—is returned; failures are always included. ' +
          'Any failed or skipped call makes the batch an error; successful results remain available. Retry only failed work after inspecting its error. ' +
          'In exec scripts do not use this tool: await the tools directly (Promise.allSettled for independent reads).',
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
                'true runs the calls concurrently and never skips one because another failed. Use it for ' +
                'independent CDP work, including independent mutations on different targets; serialize ' +
                'dependent or same-target mutations. Default false: calls run in order and a failure skips ' +
                'everything after it.'
            }
          },
          required: ['calls']
        },
        timeoutMs: BATCH_TIMEOUT_MS,
        async run(input, context) {
          const parsed = parseCalls(input, maxCalls)
          if (typeof parsed === 'string') return usageResult(`tool_batch.run: ${parsed}`)
          const unresolved = unresolvedCalls(registry(), parsed)
          if (unresolved) return usageResult(`tool_batch.run: ${unresolved}`)
          const parallel = booleanArg(input, 'parallel', false)
          const policyProblem = validateRealInputBatch(parsed, parallel)
          if (policyProblem) return usageResult(`tool_batch.run: ${policyProblem}`)
          if (parallel) return assembleResult(parsed, await runParallel(registry(), parsed, context), [])
          const { outcomes, unwound } = await runSequential(registry(), parsed, context)
          return assembleResult(parsed, outcomes, unwound)
        }
      })
    ]
  }
}

/**
 * Every name is resolved against the registry before the first call runs. A batch that names a
 * tool the app does not own — most often one of the model's own harness tools, which look like
 * peers of these in its tool list but are not dispatchable here — fails as a unit and says what
 * is routable, instead of half-executing and reporting a bare "Unknown tool" from mid-sequence.
 */
function unresolvedCalls(registry: ToolRegistry, calls: BatchCall[]): string | null {
  const unresolved = calls.filter((call) => !registry.find(call.namespace, call.tool))
  if (unresolved.length === 0) return null
  const named = unresolved.map((call) => `[${call.index}] "${call.label}"`).join(', ')
  const routable = registry.names().filter((name) => !name.startsWith(`${TOOL_BATCH_NAMESPACE}.`))
  return `${named} ${unresolved.length === 1 ? 'is not a tool' : 'are not tools'} this app owns, so nothing ran. ` +
    `A batch can only run: ${routable.join(', ')}. Tools your own harness provides (file read/search/edit, ` +
    'shell, web fetch) are not routable through a batch — call those directly.'
}

/** Real input cannot hide in a one-call or parallel batch; a later read must assert the outcome. */
function validateRealInputBatch(calls: BatchCall[], parallel: boolean): string | null {
  const fallbackIndexes = calls.flatMap((call, index) => isRealInputCall(call) ? [index] : [])
  if (fallbackIndexes.length === 0) return null
  if (parallel) return 'real-input fallbacks must run in a sequential batch'
  for (const index of fallbackIndexes) {
    if (!calls.slice(index + 1).some(isVerificationCall)) {
      return `real-input fallback call [${calls[index]!.index}] needs a later read or wait action that verifies its result`
    }
  }
  return null
}

function isRealInputCall(call: BatchCall): boolean {
  const action = typeof call.arguments.action === 'string' ? call.arguments.action : ''
  if (call.namespace === 'closedai_app' && call.tool === 'ui') {
    return ['click', 'type', 'press_key'].includes(action)
  }
  if (call.namespace === 'browser_cdp' && call.tool === 'page') {
    return ['click', 'click_at', 'type', 'press_key', 'dismiss_overlay'].includes(action)
  }
  return call.namespace === 'browser_cdp' && call.tool === 'protocol' && action === 'command' &&
    typeof call.arguments.method === 'string' && call.arguments.method.startsWith('Input.')
}

function isVerificationCall(call: BatchCall): boolean {
  const action = typeof call.arguments.action === 'string' ? call.arguments.action : ''
  if (call.namespace === 'closedai_app' && call.tool === 'state') return true
  if (call.namespace === 'closedai_app' && call.tool === 'ui') return ['controls', 'wait_for'].includes(action)
  if (call.namespace === 'browser_cdp' && call.tool === 'page') return action === 'inspect_page'
  if (call.namespace === 'browser_cdp' && call.tool === 'protocol') {
    return ['targets', 'events', 'requests', 'body'].includes(action)
  }
  if (call.namespace === 'embedded_browser' && call.tool === 'page') {
    return ['read_page', 'wait_for', 'extract', 'query', 'console'].includes(action)
  }
  if (call.namespace === 'embedded_browser' && call.tool === 'network') {
    return ['requests', 'wait', 'body', 'rules'].includes(action)
  }
  if (call.namespace === 'embedded_browser' && call.tool === 'session') return action === 'cookies'
  return call.namespace === 'closedai_ui' && call.tool === 'capture' &&
    ['app_window', 'browser_page'].includes(action)
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
      paneId: context.paneId,
      threadId: context.threadId,
      turnId: context.turnId,
      callId: `${context.callId}#${call.index}`,
      parentCallId: context.callId,
      batchId: context.callId,
      source: 'batch',
      parentSignal: context.signal
    }
  )
}

/**
 * In-order execution treats the batch as one plan: a failed step invalidates the steps
 * behind it (they usually depend on it), so they are reported as skipped rather than run
 * against a state the model did not intend.
 *
 * The same reasoning applies to what already ran. A step that armed invisible browser state
 * belongs to the plan that just failed, so it is released again before the batch returns rather
 * than left running on a tab the caller has stopped reasoning about.
 */
async function runSequential(
  registry: ToolRegistry,
  calls: BatchCall[],
  context: ToolContext
): Promise<{ outcomes: BatchOutcome[]; unwound: UnwindRecord[] }> {
  const outcomes: BatchOutcome[] = []
  const armed: Compensation[] = []
  let skipReason: string | null = null
  for (const call of calls) {
    if (!skipReason && context.signal.aborted) skipReason = 'the batch timed out'
    if (skipReason) {
      outcomes.push({ status: 'skipped', reason: skipReason })
      continue
    }
    const result = await dispatch(registry, call, context)
    outcomes.push({ status: 'ran', result })
    if (result.isError) {
      skipReason = `call [${call.index}] failed and the batch is sequential`
      continue
    }
    // A successful release settles what the plan armed; nothing is left to compensate.
    for (let index = armed.length - 1; index >= 0; index -= 1) {
      if (releases(call, armed[index]!)) armed.splice(index, 1)
    }
    const compensation = compensationFor(call)
    if (compensation) armed.push(compensation)
  }
  return { outcomes, unwound: skipReason ? await unwind(registry, armed, context) : [] }
}

export type UnwindRecord = { label: string; ok: boolean; detail?: string }

/**
 * Release in reverse order, and deliberately without the batch's abort signal: a batch that ran
 * out of time is exactly when armed state must still be cleaned up.
 */
async function unwind(
  registry: ToolRegistry,
  armed: Compensation[],
  context: ToolContext
): Promise<UnwindRecord[]> {
  const records: UnwindRecord[] = []
  for (const compensation of [...armed].reverse()) {
    try {
      const result = await registry.call(compensation.call, {
        paneId: context.paneId,
        threadId: context.threadId,
        turnId: context.turnId,
        callId: `${context.callId}#unwind${records.length + 1}`,
        parentCallId: context.callId,
        batchId: context.callId,
        source: 'batch'
      })
      records.push({ label: compensation.label, ok: !result.isError })
    } catch (error) {
      records.push({
        label: compensation.label,
        ok: false,
        detail: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return records
}

async function runParallel(registry: ToolRegistry, calls: BatchCall[], context: ToolContext): Promise<BatchOutcome[]> {
  const outcomes = new Map<number, BatchOutcome>()
  const groups = parallelGroups(calls)
  // Each group is one serial target lane. Run every independent lane immediately rather than
  // imposing an arbitrary global width; explicit tab ids are what unlock browser concurrency.
  await allSettledBounded(groups, groups.length, async (group) => {
    for (const call of group) {
      if (context.signal.aborted) {
        outcomes.set(call.index, { status: 'skipped', reason: 'the batch timed out' })
        continue
      }
      try {
        outcomes.set(call.index, { status: 'ran', result: await dispatch(registry, call, context) })
      } catch (error) {
        outcomes.set(call.index, {
          status: 'ran',
          result: failureResult(error instanceof Error ? error.message : String(error))
        })
      }
    }
  })
  return calls.map((call) => outcomes.get(call.index) ?? {
    status: 'ran', result: failureResult(`call [${call.index}] did not produce a result`)
  })
}

/**
 * Calls with a known tab id share one lane. An active-tab fallback or tab-strip mutation can
 * change which WebContents is active, so it becomes a browser-wide barrier for the whole batch.
 * Unrelated calls each receive their own lane and therefore retain maximum concurrency.
 */
function parallelGroups(calls: BatchCall[]): BatchCall[][] {
  const scopes = calls.map(batchResourceKey)
  const hasBrowserBarrier = scopes.includes('browser:global')
  const grouped = new Map<string, BatchCall[]>()
  calls.forEach((call, index) => {
    const scope = scopes[index]
    const key = scope?.startsWith('browser:') && hasBrowserBarrier ? 'browser:global' : scope ?? `independent:${call.index}`
    const group = grouped.get(key)
    if (group) group.push(call)
    else grouped.set(key, [call])
  })
  return [...grouped.values()]
}

/**
 * Batch lanes are broader than cross-pane exclusive locks: reads do not lock a tab against
 * another chat, but they must still remain ordered with mutations to that tab inside one plan.
 */
function batchResourceKey(call: BatchCall): string | null {
  const exclusive = resourceKey({
    namespace: call.namespace, tool: call.tool, arguments: call.arguments
  }, call.arguments)
  if (exclusive) return exclusive
  const tab = typeof call.arguments.tab_id === 'string' && call.arguments.tab_id.length > 0
    ? call.arguments.tab_id
    : null
  if (call.namespace === 'embedded_browser' && call.tool === 'page') {
    return tab ? `browser:tab:${tab}` : 'browser:global'
  }
  if (call.namespace === 'browser_cdp' && ['page', 'protocol'].includes(call.tool)) {
    return tab ? `browser:tab:${tab}` : 'browser:global'
  }
  return null
}

/** Separate call blocks let the registry's aggregate budget preserve short failures and ids. */
function assembleResult(calls: BatchCall[], outcomes: BatchOutcome[], unwound: UnwindRecord[]): ToolResult {
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
  if (unwound.length) {
    const released = unwound
      .map((record) => `${record.label} — ${record.ok ? 'released' : `still armed: ${record.detail ?? 'the release failed'}`}`)
      .join('; ')
    sections.push(`Unwound after the failure: ${released}.`)
  }
  return {
    content: [
      { type: 'text', text: summary },
      ...sections.map((section): ToolContent => ({ type: 'text', text: section })),
      ...images
    ],
    // Preserve successful evidence without claiming a partially executed plan completed.
    ...(succeeded !== calls.length || unwound.some((record) => !record.ok) ? { isError: true } : {})
  }
}
