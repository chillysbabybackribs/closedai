import { EventEmitter } from 'node:events'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import type { ToolCallRecord, ToolStats, ToolTelemetrySnapshot } from '../../shared/tools.js'

// Every tool call the registry runs, kept as a bounded in-memory window and appended to a
// JSONL file so the history survives restarts. Stats are computed over the retained window
// only; the file is the long-term record.

export const DEFAULT_RETAINED = 500

export class ToolTelemetry extends EventEmitter {
  private records: ToolCallRecord[]
  private writes: Promise<void> = Promise.resolve()

  private constructor(
    private readonly filePath: string | null,
    records: ToolCallRecord[],
    private readonly retained: number
  ) {
    super()
    this.records = records.slice(-retained)
  }

  /** In-memory only; for tests and for a missing user-data directory. */
  static ephemeral(retained = DEFAULT_RETAINED): ToolTelemetry {
    return new ToolTelemetry(null, [], retained)
  }

  static async open(filePath: string, retained = DEFAULT_RETAINED): Promise<ToolTelemetry> {
    let records: ToolCallRecord[] = []
    try {
      const lines = (await readFile(filePath, 'utf8')).split('\n')
      records = lines.slice(-retained * 2).flatMap((line) => {
        if (!line.trim()) return []
        try {
          const parsed: unknown = JSON.parse(line)
          return isRecord(parsed) ? [parsed] : []
        } catch {
          return []
        }
      })
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code !== 'ENOENT') console.warn('[tools] telemetry unreadable, starting empty:', messageOf(error))
    }
    return new ToolTelemetry(filePath, records, retained)
  }

  record(record: ToolCallRecord): void {
    this.records.push(record)
    if (this.records.length > this.retained) this.records.splice(0, this.records.length - this.retained)
    this.emit('record', record)
    if (this.filePath) this.enqueue(() => appendFile(this.filePath!, `${JSON.stringify(record)}\n`))
  }

  snapshot(limit = 100): ToolTelemetrySnapshot {
    return {
      stats: computeStats(this.records),
      recent: this.records.slice(-limit).reverse(),
      retained: this.retained
    }
  }

  async clear(): Promise<void> {
    this.records = []
    this.emit('cleared')
    if (this.filePath) {
      this.enqueue(() => writeFile(this.filePath!, ''))
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
