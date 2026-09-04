import { EventEmitter } from 'node:events'
import { readFile, unlink } from 'node:fs/promises'
import type { ToolCallEvent, ToolStats, ToolTelemetrySnapshot } from '../../shared/tools.js'
import { writeAtomic } from '../atomic-write.js'

const TELEMETRY_VERSION = 1

type PersistedTelemetry = {
  version: typeof TELEMETRY_VERSION
  totalCalls: number
  stats: ToolStats[]
}

/** Aggregate tool run/error counters. No per-call content or identifiers are retained. */
export class ToolTelemetry extends EventEmitter {
  private readonly stats = new Map<string, ToolStats>()
  private totalCalls = 0
  private writes: Promise<void> = Promise.resolve()

  private constructor(private readonly filePath: string | null, snapshot?: ToolTelemetrySnapshot) {
    super()
    this.totalCalls = snapshot?.totalCalls ?? 0
    for (const stat of snapshot?.stats ?? []) this.stats.set(keyOf(stat.toolId, stat.action), { ...stat })
  }

  /** In-memory only; for tests and for a missing user-data directory. */
  static ephemeral(): ToolTelemetry {
    return new ToolTelemetry(null)
  }

  /** Open aggregate counters and replace a legacy per-call JSONL log when one exists. */
  static async open(filePath: string, legacyPath?: string): Promise<ToolTelemetry> {
    const current = await readCurrent(filePath)
    if (current) {
      await removeLegacy(legacyPath)
      return new ToolTelemetry(filePath, current)
    }

    const legacy = legacyPath ? await readLegacy(legacyPath) : null
    const telemetry = new ToolTelemetry(filePath, legacy ?? undefined)
    if (legacy) await telemetry.persistNow()
    await removeLegacy(legacyPath)
    return telemetry
  }

  record(record: ToolCallEvent): void {
    this.totalCalls += 1
    this.bump(record.toolId, null, record)
    if (record.action) this.bump(record.toolId, record.action, record)
    this.emit('record', record)
    this.enqueuePersist()
  }

  snapshot(): ToolTelemetrySnapshot {
    return {
      stats: [...this.stats.values()].sort(compareStats),
      totalCalls: this.totalCalls
    }
  }

  async clear(): Promise<void> {
    this.stats.clear()
    this.totalCalls = 0
    this.emit('cleared')
    this.enqueuePersist()
    await this.writes
  }

  private bump(toolId: string, action: string | null, record: ToolCallEvent): void {
    bumpMap(this.stats, toolId, action, record)
  }

  private enqueuePersist(): void {
    if (!this.filePath) return
    this.writes = this.writes.then(() => this.persistNow()).catch((error: unknown) => {
      console.warn('[tools] telemetry write failed:', messageOf(error))
    })
  }

  private persistNow(): Promise<void> {
    if (!this.filePath) return Promise.resolve()
    const persisted: PersistedTelemetry = {
      version: TELEMETRY_VERSION,
      totalCalls: this.totalCalls,
      stats: [...this.stats.values()].sort(compareStats)
    }
    return writeAtomic(this.filePath, `${JSON.stringify(persisted, null, 2)}\n`)
  }
}

async function readCurrent(filePath: string): Promise<ToolTelemetrySnapshot | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    return normalizeSnapshot(parsed)
  } catch (error) {
    if (codeOf(error) !== 'ENOENT') console.warn('[tools] aggregate telemetry unreadable, starting empty:', messageOf(error))
    return null
  }
}

/** Read only the non-sensitive counters from the old records; all other fields are discarded. */
async function readLegacy(filePath: string): Promise<ToolTelemetrySnapshot | null> {
  try {
    const stats = new Map<string, ToolStats>()
    let totalCalls = 0
    for (const line of (await readFile(filePath, 'utf8')).split('\n')) {
      if (!line.trim()) continue
      try {
        const record = legacyRecord(JSON.parse(line))
        if (!record) continue
        totalCalls += 1
        bumpMap(stats, record.toolId, null, record)
        if (record.action) bumpMap(stats, record.toolId, record.action, record)
      } catch {
        // A corrupt line should not hide valid counters around it.
      }
    }
    return { stats: [...stats.values()], totalCalls }
  } catch (error) {
    if (codeOf(error) !== 'ENOENT') console.warn('[tools] legacy telemetry unreadable, starting empty:', messageOf(error))
    return null
  }
}

function normalizeSnapshot(value: unknown): ToolTelemetrySnapshot {
  if (!value || typeof value !== 'object') throw new Error('invalid telemetry file')
  const persisted = value as Partial<PersistedTelemetry>
  if (persisted.version !== TELEMETRY_VERSION || !Array.isArray(persisted.stats)) throw new Error('unsupported telemetry file')
  const stats = persisted.stats.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const stat = entry as Partial<ToolStats>
    if (typeof stat.toolId !== 'string' || (stat.action !== null && typeof stat.action !== 'string')) return []
    if (!Number.isInteger(stat.calls) || stat.calls! < 0 || !Number.isInteger(stat.failures) || stat.failures! < 0) return []
    const timeouts = Number.isInteger(stat.timeouts) && stat.timeouts! >= 0 ? stat.timeouts! : 0
    // Counters written before misuse was tracked simply start at zero rather than forcing a migration.
    const misuses = Number.isInteger(stat.misuses) && stat.misuses! >= 0 ? stat.misuses! : 0
    const failures = Math.min(stat.failures!, stat.calls!)
    return [{
      toolId: stat.toolId,
      action: stat.action,
      calls: stat.calls!,
      failures,
      timeouts: Math.min(timeouts, stat.calls!),
      misuses: Math.min(misuses, failures)
    }]
  })
  const totalCalls = Number.isInteger(persisted.totalCalls) && persisted.totalCalls! >= 0
    ? persisted.totalCalls!
    : stats.filter((stat) => stat.action === null).reduce((sum, stat) => sum + stat.calls, 0)
  return { stats, totalCalls }
}

function legacyRecord(value: unknown): ToolCallEvent | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.toolId !== 'string' || typeof record.ok !== 'boolean') return null
  return {
    toolId: record.toolId,
    action: typeof record.action === 'string' ? record.action : null,
    ok: record.ok,
    timedOut: false,
    misuse: false
  }
}

function bumpMap(
  stats: Map<string, ToolStats>,
  toolId: string,
  action: string | null,
  record: Pick<ToolCallEvent, 'ok' | 'timedOut' | 'misuse'>
): void {
  const key = keyOf(toolId, action)
  const current = stats.get(key) ?? { toolId, action, calls: 0, failures: 0, timeouts: 0, misuses: 0 }
  const failed = !record.ok && !record.timedOut
  stats.set(key, {
    ...current,
    calls: current.calls + 1,
    failures: current.failures + (failed ? 1 : 0),
    timeouts: current.timeouts + (record.timedOut ? 1 : 0),
    misuses: current.misuses + (failed && record.misuse ? 1 : 0)
  })
}

function keyOf(toolId: string, action: string | null): string {
  return `${toolId}\u0000${action ?? ''}`
}

function compareStats(left: ToolStats, right: ToolStats): number {
  return left.toolId.localeCompare(right.toolId) || (left.action ?? '').localeCompare(right.action ?? '')
}

function codeOf(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function removeLegacy(filePath?: string): Promise<void> {
  if (!filePath) return
  try {
    await unlink(filePath)
  } catch (error) {
    if (codeOf(error) !== 'ENOENT') console.warn('[tools] could not remove legacy telemetry:', messageOf(error))
  }
}
