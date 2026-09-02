// Shared bounds keep persisted settings and the runtime tool definition in agreement.
// The upper bound limits accidental fan-out while still leaving room for larger workflows.

export const DEFAULT_TOOL_BATCH_MAX_CALLS = 16
export const MIN_TOOL_BATCH_MAX_CALLS = 1
export const MAX_TOOL_BATCH_MAX_CALLS = 64

export function normalizeToolBatchMaxCalls(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TOOL_BATCH_MAX_CALLS
  return Math.min(MAX_TOOL_BATCH_MAX_CALLS, Math.max(MIN_TOOL_BATCH_MAX_CALLS, Math.round(value)))
}
