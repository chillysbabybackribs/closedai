import type { TraceEntry } from '../../shared/trace.js'

export type TraceTokenTotals = {
  input: number
  cachedInput: number
  uncachedInput: number
  output: number
  reasoning: number
}

export type TracePerformance = {
  response: {
    firstTextMs: number
    preparationMs: number
    compactionWaitMs: number
    afterDispatchMs: number
  } | null
  modelPasses: number
  tokens: TraceTokenTotals | null
  lastContext: { used: number; window: number; percent: number } | null
  toolCalls: number
  toolFailures: number
  toolDurationMs: number
  nonToolDurationMs: number | null
  transcriptEvents: number
  rawEvents: number
}

type RecordValue = Record<string, unknown>

/** Derive workload-level efficiency from the complete turn, independent of visible filters. */
export function summarizeTracePerformance(
  entries: TraceEntry[],
  durationMs: number | null
): TracePerformance {
  let modelPasses = 0
  let tokens: TraceTokenTotals | null = null
  let lastContext: TracePerformance['lastContext'] = null
  let toolCalls = 0
  let toolFailures = 0
  let toolDurationMs = 0
  let transcriptEvents = 0
  let rawEvents = 0
  let response: TracePerformance['response'] = null

  for (const entry of entries) {
    if (entry.label === 'response.first_text') response ??= responseTiming(entry.detail)
    if (entry.kind === 'event') transcriptEvents += 1
    if (entry.kind === 'raw') rawEvents += 1
    if (entry.kind === 'tool' && entry.label === 'tool.call') toolCalls += 1
    if (entry.kind === 'tool' && entry.label === 'tool.result') {
      toolDurationMs += entry.durationMs ?? 0
      if (entry.ok === false) toolFailures += 1
    }
    if (entry.kind !== 'raw') continue

    if (entry.summary === 'thread/tokenUsage/updated') {
      const usage = codexUsage(entry.detail)
      if (usage) {
        modelPasses += 1
        tokens = usage.tokens
        lastContext = usage.lastContext
      }
      continue
    }
    if (entry.label === 'claude.in' && entry.summary.startsWith('assistant')) modelPasses += 1
    if (entry.label === 'claude.in' && entry.summary.startsWith('result')) {
      const usage = claudeUsage(entry.detail)
      if (usage) {
        tokens = usage.tokens
        modelPasses = Math.max(modelPasses, usage.modelPasses)
      }
    }
  }

  return {
    response,
    modelPasses,
    tokens,
    lastContext,
    toolCalls,
    toolFailures,
    toolDurationMs,
    nonToolDurationMs: durationMs === null ? null : Math.max(0, durationMs - toolDurationMs),
    transcriptEvents,
    rawEvents
  }
}

function responseTiming(detail: string): TracePerformance['response'] {
  const value = parseRecord(detail)
  if (!value) return null
  const { elapsedMs, preparationMs, compactionWaitMs, afterDispatchMs } = value
  const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
  if (!valid(elapsedMs) || !valid(preparationMs) || !valid(compactionWaitMs) || !valid(afterDispatchMs)) return null
  return { firstTextMs: elapsedMs, preparationMs, compactionWaitMs, afterDispatchMs }
}

function codexUsage(detail: string): {
  tokens: TraceTokenTotals
  lastContext: TracePerformance['lastContext']
} | null {
  const message = parseRecord(detail)
  const params = record(message?.params)
  const usage = record(params?.tokenUsage)
  const total = record(usage?.total)
  const last = record(usage?.last)
  if (!total || !last) return null
  const input = number(total.inputTokens)
  const cachedInput = Math.min(input, number(total.cachedInputTokens))
  const lastTotal = number(last.totalTokens)
  const lastReasoning = number(last.reasoningOutputTokens)
  const window = number(usage?.modelContextWindow)
  const used = Math.max(0, lastTotal - lastReasoning)
  return {
    tokens: {
      input,
      cachedInput,
      uncachedInput: Math.max(0, input - cachedInput),
      output: number(total.outputTokens),
      reasoning: number(total.reasoningOutputTokens)
    },
    lastContext: window > 0 && used > 0
      ? { used, window, percent: Math.round((used / window) * 100) }
      : null
  }
}

function claudeUsage(detail: string): { tokens: TraceTokenTotals; modelPasses: number } | null {
  const message = parseRecord(detail)
  const models = record(message?.modelUsage)
  if (!message || !models) return null
  let input = 0
  let cachedInput = 0
  let uncachedInput = 0
  let output = 0
  let reasoning = 0
  for (const candidate of Object.values(models)) {
    const usage = record(candidate)
    if (!usage) continue
    const cacheRead = number(usage.cacheReadInputTokens)
    const cacheCreation = number(usage.cacheCreationInputTokens)
    const directInput = number(usage.inputTokens)
    input += directInput + cacheRead + cacheCreation
    cachedInput += cacheRead
    uncachedInput += directInput + cacheCreation
    output += number(usage.outputTokens)
    reasoning += number(usage.thinkingTokens)
  }
  if (input + output === 0) return null
  return {
    tokens: { input, cachedInput, uncachedInput, output, reasoning },
    modelPasses: number(message.num_turns)
  }
}

function parseRecord(value: string): RecordValue | null {
  try {
    return record(JSON.parse(value))
  } catch {
    return null
  }
}

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : null
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}
