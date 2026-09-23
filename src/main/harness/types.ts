/** Simulation harness: task definitions, oracles, and run reports. */

export type ToolCallSpec = {
  namespace: string
  tool: string
  arguments: Record<string, unknown>
}

export type OracleMustCall = ToolCallSpec & {
  /** When true, only listed argument keys must match (default true). */
  partialArgs?: boolean
}

export type HarnessOracle = {
  must_call?: OracleMustCall[]
  must_not_call?: ToolCallSpec[]
  max_tool_calls?: number
  /** When set, every replay step must succeed (no isError / usage). */
  expect_success?: boolean
}

/** One deterministic simulation: replay tool calls through stub hosts, score with oracle. */
export type HarnessSimulationTask = {
  id: string
  tool: string
  intent?: string
  /** User message for model-backed runs (Phase 2). */
  user?: string
  fixture?: string
  replay: ToolCallSpec[]
  oracle: HarnessOracle
  tags?: string[]
  source?: string
  /** Cartesian product of argument overrides applied to each replay step's arguments. */
  variations?: Record<string, unknown[]>
}

export type RecordedToolCall = ToolCallSpec & {
  isError?: boolean
  errorKind?: 'timeout' | 'usage'
}

export type SimulationRunResult = {
  taskId: string
  variationKey: string
  passed: boolean
  failures: string[]
  calls: RecordedToolCall[]
  durationMs: number
  skipped?: boolean
  skipReason?: string
}

export type SimulationReport = {
  runId: string
  mode: 'replay' | 'model-golden' | 'model-codex'
  startedAt: string
  finishedAt: string
  concurrency: number
  totals: { runs: number; passed: number; failed: number }
  results: SimulationRunResult[]
  /** Ranked by pass rate then fewer failures (for variant comparison). */
  summaryByTask: Array<{ taskId: string; passed: number; failed: number; passRate: number }>
}
