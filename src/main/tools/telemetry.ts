import { EventEmitter } from 'node:events'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import type { ToolCallRecord, ToolRegistration, ToolStats, ToolTelemetrySnapshot } from '../../shared/tools.js'

// Every tool call the registry runs, kept as a bounded in-memory window and appended to a
// JSONL file so the history survives restarts. Stats are computed over the retained window
// only; the file is the long-term record.

export const DEFAULT_RETAINED = 500

type ToolRegistrationEvent = {
  type: 'tool_registered'
  tool: ToolRegistration
}

type ToolDefinitionInput = {
  toolId: string
  namespace: string
  name: string
  actions: string[]
}

export class ToolTelemetry extends EventEmitter {
  private records: ToolCallRecord[]
  private readonly tools: Map<string, ToolRegistration>
  private totalCalls: number
  private writes: Promise<void> = Promise.resolve()

  private constructor(
    private readonly filePath: string | null,
    records: ToolCallRecord[],
    tools: Map<string, ToolRegistration>,
    totalCalls: number,
    private readonly retained: number
  ) {
    super()
    this.records = records.slice(-retained)
    this.tools = tools
    this.totalCalls = totalCalls
  }

  /** In-memory only; for tests and for a missing user-data directory. */
  static ephemeral(retained = DEFAULT_RETAINED): ToolTelemetry {
    return new ToolTelemetry(null, [], new Map(), 0, retained)
  }

  static async open(filePath: string, retained = DEFAULT_RETAINED): Promise<ToolTelemetry> {
    const records: ToolCallRecord[] = []
    const tools = new Map<string, ToolRegistration>()
    let totalCalls = 0
    try {
      const lines = (await readFile(filePath, 'utf8')).split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed: unknown = JSON.parse(line)
          if (isToolRegistrationEvent(parsed)) {
            tools.set(parsed.tool.toolId, { ...parsed.tool, source: parsed.tool.source ?? 'app' })
          } else if (isRecord(parsed)) {
            totalCalls += 1
            records.push(parsed)
            if (records.length > retained) records.shift()
          }
        } catch {
          // A corrupt line should not hide valid telemetry around it.
        }
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code !== 'ENOENT') console.warn('[tools] telemetry unreadable, starting empty:', messageOf(error))
    }
    return new ToolTelemetry(filePath, records, tools, totalCalls, retained)
  }

  record(record: ToolCallRecord): void {
    this.records.push(record)
    this.totalCalls += 1
    if (this.records.length > this.retained) this.records.splice(0, this.records.length - this.retained)
    this.emit('record', record)
    if (this.filePath) this.enqueue(() => appendFile(this.filePath!, `${JSON.stringify(record)}\n`))
  }

  /** Adapter boundary for host tools that do not execute through ToolRegistry. */
  recordExternal(record: ToolCallRecord): void {
    this.record({ ...record, source: 'external' })
  }

  /** Register every tool/action definition currently offered by the registry. */
  observeTools(definitions: ToolDefinitionInput[], source: ToolRegistration['source'] = 'app'): void {
    for (const definition of definitions) {
      const current = this.tools.get(definition.toolId)
      if (current && current.namespace === definition.namespace && current.name === definition.name && sameStrings(current.actions, definition.actions)) continue
      const now = Date.now()
      const registration: ToolRegistration = {
        ...definition,
        actions: [...definition.actions],
        source,
        firstSeenAt: current?.firstSeenAt ?? now,
        lastSeenAt: now
      }
      this.tools.set(definition.toolId, registration)
      this.emit('registered', registration)
      if (this.filePath) {
        const event: ToolRegistrationEvent = { type: 'tool_registered', tool: registration }
        this.enqueue(() => appendFile(this.filePath!, `${JSON.stringify(event)}\n`))
      }
    }
  }

  snapshot(limit = 100): ToolTelemetrySnapshot {
    return {
      stats: computeStats(this.records),
      recent: this.records.slice(-limit).reverse(),
      retained: this.retained,
      totalCalls: this.totalCalls,
      registeredTools: [...this.tools.values()].sort((a, b) => a.toolId.localeCompare(b.toolId))
    }
  }

  async clear(): Promise<void> {
    this.records = []
    this.totalCalls = 0
    this.emit('cleared')
    if (this.filePath) {
      const registrations = [...this.tools.values()].map((tool) => `${JSON.stringify({ type: 'tool_registered', tool } satisfies ToolRegistrationEvent)}\n`).join('')
      this.enqueue(() => writeFile(this.filePath!, registrations))
      await this.writes
    }
  }

  /** Serialise file writes so appends never interleave and clear() cannot race an append. */
  private enqueue(write: () => Promise<void>): void {
    this.writes = this.writes.then(write).catch((error: unknown) => {
      console.warn('[tools] telemetry write failed:', messageOf(error))
    })
  }
}

/** One entry per tool (action null) plus one per (tool, action) pair seen. */
export function computeStats(records: ToolCallRecord[]): ToolStats[] {
  type Bucket = { toolId: string; action: string | null; calls: number; failures: number; totalMs: number; lastAt: number }
  const buckets = new Map<string, Bucket>()
  const bump = (toolId: string, action: string | null, record: ToolCallRecord): void => {
    const key = action ? `${toolId}\u0000${action}` : toolId
    const entry = buckets.get(key) ?? { toolId, action, calls: 0, failures: 0, totalMs: 0, lastAt: 0 }
    entry.calls += 1
    if (!record.ok) entry.failures += 1
    entry.totalMs += record.durationMs
    entry.lastAt = Math.max(entry.lastAt, record.at)
    buckets.set(key, entry)
  }
  for (const record of records) {
    bump(record.toolId, null, record)
    if (record.action) bump(record.toolId, record.action, record)
  }
  return [...buckets.values()]
    .map((entry) => ({
      toolId: entry.toolId,
      action: entry.action,
      calls: entry.calls,
      failures: entry.failures,
      averageMs: Math.round(entry.totalMs / entry.calls),
      lastAt: entry.lastAt || null
    }))
    .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
}

function isRecord(value: unknown): value is ToolCallRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.toolId === 'string' && typeof record.at === 'number' && typeof record.ok === 'boolean'
}

function isToolRegistrationEvent(value: unknown): value is ToolRegistrationEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<ToolRegistrationEvent>
  const tool = event.tool
  return event.type === 'tool_registered' && Boolean(tool) && typeof tool?.toolId === 'string'
    && typeof tool.namespace === 'string' && typeof tool.name === 'string'
    && Array.isArray(tool.actions) && tool.actions.every((action) => typeof action === 'string')
    && (tool.source === undefined || tool.source === 'app' || tool.source === 'external')
    && typeof tool.firstSeenAt === 'number' && typeof tool.lastSeenAt === 'number'
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
