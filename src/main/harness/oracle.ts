import type { HarnessOracle, OracleMustCall, RecordedToolCall, ToolCallSpec } from './types.js'

function argsMatch(expected: Record<string, unknown>, actual: Record<string, unknown>, partial: boolean): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (!(key in actual)) return false
    const got = actual[key]
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if (typeof got !== 'object' || got === null || Array.isArray(got)) return false
      if (!argsMatch(value as Record<string, unknown>, got as Record<string, unknown>, partial)) return false
      continue
    }
    if (got !== value) return false
  }
  if (!partial) {
    for (const key of Object.keys(actual)) {
      if (!(key in expected)) return false
    }
  }
  return true
}

function callMatches(spec: ToolCallSpec, call: RecordedToolCall, partialArgs: boolean): boolean {
  if (spec.namespace !== call.namespace || spec.tool !== call.tool) return false
  return argsMatch(spec.arguments, call.arguments, partialArgs)
}

function findMustCall(spec: OracleMustCall, calls: RecordedToolCall[]): RecordedToolCall | undefined {
  const partial = spec.partialArgs !== false
  return calls.find((call) => callMatches(spec, call, partial))
}

export function scoreOracle(oracle: HarnessOracle, calls: RecordedToolCall[]): string[] {
  const failures: string[] = []
  const max = oracle.max_tool_calls
  if (max !== undefined && calls.length > max) {
    failures.push(`expected at most ${max} tool calls, got ${calls.length}`)
  }
  for (const spec of oracle.must_call ?? []) {
    if (!findMustCall(spec, calls)) {
      failures.push(`missing required call ${spec.namespace}.${spec.tool} ${JSON.stringify(spec.arguments)}`)
    }
  }
  for (const spec of oracle.must_not_call ?? []) {
    if (findMustCall({ ...spec, partialArgs: true }, calls)) {
      failures.push(`forbidden call ${spec.namespace}.${spec.tool} ${JSON.stringify(spec.arguments)}`)
    }
  }
  if (oracle.expect_success !== false) {
    for (const call of calls) {
      if (call.isError || call.errorKind === 'usage') {
        failures.push(`call ${call.namespace}.${call.tool} failed: ${call.errorKind ?? 'error'}`)
      }
    }
  }
  return failures
}
