import { EventEmitter } from 'node:events'
import type { ChatProvider } from '../../shared/chat.js'
import type { TraceEntry, TraceEvent, TraceKind, TraceSnapshot } from '../../shared/trace.js'

// In-memory ring of everything the main process saw the model do. One instance per process;
// the taps (provider clients, the tool registry, the chat event stream) record into it and the
// renderer reads it through IPC. Bounded by entry count and total text so a long session
// cannot grow without limit; oldest entries are evicted first.

export const MAX_ENTRIES = 4_000
export const MAX_TOTAL_CHARS = 24_000_000
export const MAX_DETAIL_CHARS = 48_000
const TRUNCATION_MARK = '\n… [truncated by the trace; the provider received the full payload]'

export type TraceScope = {
  paneId: string | null
  provider: ChatProvider | null
  turnId: string | null
}

export type TraceInput = {
  kind: TraceKind
  label: string
  summary: string
  detail: unknown
  direction?: 'in' | 'out'
  durationMs?: number
  ok?: boolean
}

export class TraceLog extends EventEmitter {
  private entries: TraceEntry[] = []
  private totalChars = 0
  private dropped = 0
  private nextSeq = 1
  private readonly turnStarts = new Map<string, number>()

  record(scope: TraceScope, input: TraceInput): TraceEntry {
    const { text, truncated } = serialize(input.detail)
    const entry: TraceEntry = {
      seq: this.nextSeq++,
      at: Date.now(),
      paneId: scope.paneId,
      provider: scope.provider,
      turnId: scope.turnId,
      kind: input.kind,
      label: input.label,
      summary: input.summary,
      ...(input.direction ? { direction: input.direction } : {}),
      ...(input.durationMs !== undefined ? { durationMs: Math.round(input.durationMs) } : {}),
      ...(input.ok !== undefined ? { ok: input.ok } : {}),
      detail: text,
      truncated
    }
    this.entries.push(entry)
    this.totalChars += text.length
    this.evict()
    this.emit('event', { type: 'entry', entry } satisfies TraceEvent)
    return entry
  }

  /** A pane's turn opened (`turnId` set) or closed (`null`); closes carry the turn's duration. */
  noteTurn(paneId: string | null, provider: ChatProvider | null, turnId: string | null): void {
    const key = paneId ?? ''
    if (turnId) {
      this.turnStarts.set(key, Date.now())
      this.record({ paneId, provider, turnId }, { kind: 'turn', label: 'turn.start', summary: `Turn ${turnId} started`, detail: { turnId } })
      return
    }
    const startedAt = this.turnStarts.get(key)
    this.turnStarts.delete(key)
    const durationMs = startedAt === undefined ? undefined : Date.now() - startedAt
    this.record({ paneId, provider, turnId: null }, {
      kind: 'turn',
      label: 'turn.end',
      summary: durationMs === undefined ? 'Turn ended' : `Turn ended after ${formatDuration(durationMs)}`,
      detail: { durationMs },
      ...(durationMs !== undefined ? { durationMs } : {})
    })
  }

  snapshot(): TraceSnapshot {
    return { entries: [...this.entries], dropped: this.dropped, capacity: MAX_ENTRIES }
  }

  clear(): void {
    this.entries = []
    this.totalChars = 0
    this.dropped = 0
    this.emit('event', { type: 'cleared' } satisfies TraceEvent)
  }

  private evict(): void {
    while (this.entries.length > MAX_ENTRIES || (this.totalChars > MAX_TOTAL_CHARS && this.entries.length > 1)) {
      const oldest = this.entries.shift()!
      this.totalChars -= oldest.detail.length
      this.dropped += 1
    }
  }
}

/** The process-wide log every tap records into. */
export const traceLog = new TraceLog()

/** Which provider a turn id belongs to, from the prefixes the sessions mint. */
export function providerOfTurn(turnId: string | null): ChatProvider | null {
  if (!turnId) return null
  if (turnId.startsWith('claude-turn-')) return 'claude'
  if (turnId.startsWith('agy-turn-')) return 'antigravity'
  return 'codex'
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`
}

export function serialize(value: unknown): { text: string; truncated: boolean } {
  let text: string
  if (typeof value === 'string') text = value
  else {
    try {
      text = JSON.stringify(value, null, 2) ?? String(value)
    } catch {
      text = String(value)
    }
  }
  if (text.length <= MAX_DETAIL_CHARS) return { text, truncated: false }
  return { text: text.slice(0, MAX_DETAIL_CHARS) + TRUNCATION_MARK, truncated: true }
}
