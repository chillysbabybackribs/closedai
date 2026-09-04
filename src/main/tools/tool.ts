// The provider-agnostic tool contract. Every tool the app offers to a model — Codex today,
// other assistants later — is a ToolDefinition grouped into a ToolNamespace. Provider
// adapters (see app-server-tools.ts) translate this shape to each protocol; tools never
// import provider code.

import type { SourceReadObservation } from './source-read-history.js'

export type JsonObject = Record<string, unknown>

export type ToolContent =
  | { type: 'text'; text: string }
  /** A data URL (image/png or image/jpeg). */
  | { type: 'image'; dataUrl: string }

export type ToolResult = {
  content: ToolContent[]
  /** True when the call failed; the model sees the content as the failure reason. */
  isError?: boolean
  /**
   * Internal aggregate classification; provider adapters intentionally do not expose it.
   * `usage` marks a call the app refused before the tool ran — a wrong name, wrong arguments,
   * or a broken rule — which is the app failing to explain itself, not a runtime fault.
   */
  errorKind?: 'timeout' | 'usage'
  /** Internal source-version observations; stripped by the registry before provider delivery. */
  sourceReads?: SourceReadObservation[]
  /** Internal marker: redact content from the app's Turn Trace, then strip before provider delivery. */
  sensitive?: boolean
}

export type ToolContext = {
  /** Chat pane that initiated the call. Absent for system/tests and older callers. */
  paneId?: string | null
  threadId: string | null
  turnId: string | null
  callId: string
  /** Set when a tool call was dispatched by another tool, such as tool_batch. */
  parentCallId?: string | null
  /** Groups nested calls under the outer batch or orchestration request. */
  batchId?: string | null
  /** The boundary that initiated the call. */
  source?: 'model' | 'exec' | 'batch' | 'system' | 'external'
  /** Aborted when the registry times the call out. Long-running tools should honour it. */
  signal: AbortSignal
}

export type ToolDefinition = {
  /** snake_case; unique within its namespace. This is what the model calls. */
  name: string
  /** Written for the model: what it does, when to use it, what it returns. */
  description: string
  /** JSON Schema for `arguments` (always `type: object`). Validated before `run`. */
  inputSchema: JsonObject
  /** Hidden from the model's context until it searches for it. Use for rarely-needed tools. */
  deferLoading?: boolean
  /** Default 30s. The registry aborts `signal` and fails the call when exceeded. */
  timeoutMs?: number
  /** Set by defineActionTool: the verbs this tool dispatches on, for the manifest and tests. */
  actions?: readonly ToolActionMeta[]
  /** Set by defineActionTool: the same tool with only these verbs (null when none remain). */
  restrictActions?: (enabledActions: readonly string[]) => ToolDefinition | null
  run: (input: JsonObject, context: ToolContext) => Promise<ToolResult>
}

export type ToolActionMeta = {
  name: string
  description: string
  inputSchema: JsonObject
}

export type ToolNamespace = {
  /** snake_case; becomes the tool prefix the model sees (e.g. `browser`). */
  name: string
  description: string
  tools: ToolDefinition[]
}

export const DEFAULT_TOOL_TIMEOUT_MS = 30_000

export function defineTool(definition: ToolDefinition): ToolDefinition {
  return definition
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

export function failureResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

/**
 * A call the model got wrong: unknown name, invalid arguments, or a documented rule it broke.
 * Counted apart from runtime failures so the Tools panel shows which directions models keep
 * misreading — a misuse count that will not fall is a description to rewrite.
 */
export function usageResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true, errorKind: 'usage' }
}

export function timeoutResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true, errorKind: 'timeout' }
}

/** Read a string argument, or the fallback when absent. Throws on the wrong type. */
export function stringArg(input: JsonObject, key: string, fallback?: string): string | undefined {
  const value = input[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') throw new Error(`\`${key}\` must be a string`)
  return value
}

export function numberArg(input: JsonObject, key: string, fallback: number): number {
  const value = input[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`\`${key}\` must be a number`)
  return value
}

export function booleanArg(input: JsonObject, key: string, fallback: boolean): boolean {
  const value = input[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') throw new Error(`\`${key}\` must be a boolean`)
  return value
}

/** Shared schema field for exceptional pointer/keyboard input. Kept in the call trace for auditability. */
export const REAL_INPUT_FALLBACK_FIELD: JsonObject = {
  type: 'string',
  minLength: 1,
  maxLength: 500,
  description:
    'Why deterministic commands, fetch/extract, or non-input CDP could not complete this step. ' +
    'Real input is an escape hatch and must be grouped with inspection and verification in the same batch.'
}

export function requireRealInputFallback(input: JsonObject, context: ToolContext): string {
  const reason = stringArg(input, 'fallback_reason')?.trim()
  if (!reason) throw new Error('`fallback_reason` is required for real pointer or keyboard input')
  if (context.source !== 'batch' && context.source !== 'exec') {
    throw new Error('real pointer or keyboard input must run inside tool_batch.run (or one Codex exec script)')
  }
  return reason
}
