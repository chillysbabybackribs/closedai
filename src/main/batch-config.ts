// Startup configuration shared by the settings store and tool_batch factory. Keeping the
// normalization here makes persisted values and the advertised runtime limit agree.

export const DEFAULT_BATCH_MAX_CALLS = 16
export const MIN_BATCH_MAX_CALLS = 1
export const MAX_BATCH_MAX_CALLS = 64

export function normalizeBatchMaxCalls(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_BATCH_MAX_CALLS
  return Math.min(MAX_BATCH_MAX_CALLS, Math.max(MIN_BATCH_MAX_CALLS, Math.round(value)))
}
