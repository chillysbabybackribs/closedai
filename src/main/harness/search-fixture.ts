import { ToolRegistry } from '../tools/registry.js'
import type { ToolCallObserver, ToolCallTrace } from '../tools/registry.js'
import { searchTools } from '../tools/search/index.js'
import type { RecordedToolCall } from './types.js'

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** Minimal search providers stub (no network). */
export function createSearchFixtureRegistry(): {
  registry: ToolRegistry
  drainRecordedCalls: () => RecordedToolCall[]
} {
  const recorded: RecordedToolCall[] = []
  const fetchMock: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('brave.com')) return json({ grounding: { generic: [] }, sources: {} })
    if (url.includes('serper.dev')) return json({ organic: [] })
    if (url.includes('tavily.com')) return json({ results: [] })
    return json({ results: { web: [] } })
  }
  const registry = new ToolRegistry([searchTools({
    fetch: fetchMock,
    readKey: async () => 'harness-key'
  })])
  const observer: ToolCallObserver = (trace: ToolCallTrace) => {
    if (trace.phase !== 'end') return
    recorded.push({
      namespace: trace.request.namespace ?? '',
      tool: trace.request.tool,
      arguments: (trace.request.arguments ?? {}) as Record<string, unknown>,
      isError: trace.result.isError,
      errorKind: trace.result.errorKind
    })
  }
  registry.observe(observer)
  return { registry, drainRecordedCalls: () => {
    const copy = [...recorded]
    recorded.length = 0
    return copy
  } }
}
