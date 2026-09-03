import type { TraceEntry } from '../../shared/trace.js'

export type TraceTokenTotals = {
  input: number
  cachedInput: number
  uncachedInput: number
  output: number
  reasoning: number
}

export type TracePerformance = {
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

  for (const entry of entries) {
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
      tokens = claudeUsage(entry.detail) ?? tokens
    }
  }

  return {
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

function claudeUsage(detail: string): TraceTokenTotals | null {
  const message = parseRecord(detail)
  const usage = record(message?.usage)
  if (!usage) return null
  const input = number(usage.input_tokens)
  const cachedInput = Math.min(input, number(usage.cache_read_input_tokens))
  const output = number(usage.output_tokens)
  if (input + output === 0) return null
  return { input, cachedInput, uncachedInput: Math.max(0, input - cachedInput), output, reasoning: 0 }
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
