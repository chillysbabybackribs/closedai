import { EventEmitter } from 'node:events'
import type { ChatProvider } from '../../shared/chat.js'
import { chatProviderOfTurnId } from '../../shared/chat-providers.js'
import type { TraceEntry, TraceEvent, TraceKind, TraceSnapshot } from '../../shared/trace.js'
import { ResponseLatency } from './response-latency.js'

// In-memory ring of everything the main process saw the model do. One instance per process;
// the taps (provider clients, the tool registry, the chat event stream) record into it and the
// renderer reads it through IPC. Bounded by entry count and total text so a long session
// cannot grow without limit; oldest entries are evicted first.

export const MAX_ENTRIES = 4_000
export const MAX_TOTAL_CHARS = 24_000_000
export const MAX_DETAIL_CHARS = 48_000
export const MAX_SERIALIZE_NODES = 2_000
export const MAX_SERIALIZE_DEPTH = 12
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
  readonly responses = new ResponseLatency((scope, input) => this.record(scope, input))
  private entries: TraceEntry[] = []
  private head = 0
  private totalChars = 0
  private dropped = 0
  private nextSeq = 1
  private isActive = false
  private readonly turnStarts = new Map<string, number>()

  setActive(active: boolean): void {
    this.isActive = active
  }

  record(scope: TraceScope, input: TraceInput): TraceEntry {
    this.responses.outgoing(scope, input)
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
    if (this.isActive) {
      this.emit('event', { type: 'entry', entry } satisfies TraceEvent)
    }
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
    return { entries: this.entries.slice(this.head), dropped: this.dropped, capacity: MAX_ENTRIES }
  }

  clear(): void {
    this.responses.clear()
    this.entries = []
    this.head = 0
    this.totalChars = 0
    this.dropped = 0
    this.emit('event', { type: 'cleared' } satisfies TraceEvent)
  }

  private evict(): void {
    while (this.entries.length - this.head > MAX_ENTRIES || (this.totalChars > MAX_TOTAL_CHARS && this.entries.length - this.head > 1)) {
      const oldest = this.entries[this.head++]
      this.totalChars -= oldest.detail.length
      this.dropped += 1
    }
    if (this.head > 1000) {
      this.entries = this.entries.slice(this.head)
      this.head = 0
    }
  }
}

/** The process-wide log every tap records into. */
export const traceLog = new TraceLog()

/** Which provider a turn id belongs to, from the prefixes the sessions mint. */
export function providerOfTurn(turnId: string | null): ChatProvider | null {
  if (!turnId) return null
  return chatProviderOfTurnId(turnId)
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`
}

export function serialize(value: unknown): { text: string; truncated: boolean } {
  let text: string
  let truncated = false
  if (typeof value === 'string') text = value
  else {
    try {
      // Copy only a bounded prefix before encoding it. JSON.stringify's replacer still walks an
      // entire wide or deep object, even when the final string is clipped, and trace recording
      // shares the main event loop with provider IO.
      const clipped = clipStructuredDetail(value)
      truncated = clipped.truncated
      text = JSON.stringify(clipped.value, null, 2) ?? String(value)
    } catch {
      text = String(value)
    }
  }
  if (text.length <= MAX_DETAIL_CHARS && !truncated) return { text, truncated: false }
  return { text: text.slice(0, MAX_DETAIL_CHARS) + TRUNCATION_MARK, truncated: true }
}

function clipStructuredDetail(value: unknown): { value: unknown; truncated: boolean } {
  const seen = new WeakSet<object>()
  let nodes = 0
  let characters = 0
  let truncated = false

  const visit = (item: unknown, depth: number): unknown => {
    nodes += 1
    if (nodes > MAX_SERIALIZE_NODES) {
      truncated = true
      return undefined
    }
    if (typeof item === 'string') {
      const remaining = Math.max(0, MAX_DETAIL_CHARS - characters)
      characters += Math.min(item.length, remaining)
      if (item.length > remaining) truncated = true
      return item.slice(0, remaining)
    }
    if (item === null || typeof item === 'number' || typeof item === 'boolean') return item
    if (typeof item === 'bigint') return String(item)
    if (typeof item !== 'object') return undefined
    if (depth >= MAX_SERIALIZE_DEPTH || seen.has(item)) {
      truncated = true
      return seen.has(item) ? '[circular]' : '[trace depth limit]'
    }
    seen.add(item)
    if (Array.isArray(item)) {
      const copy: unknown[] = []
      for (let index = 0; index < item.length && nodes < MAX_SERIALIZE_NODES; index += 1) {
        copy.push(visit(item[index], depth + 1))
      }
      if (copy.length < item.length) truncated = true
      return copy
    }
    const copy: Record<string, unknown> = {}
    for (const key in item) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) continue
      if (nodes >= MAX_SERIALIZE_NODES) {
        truncated = true
        break
      }
      copy[key] = visit((item as Record<string, unknown>)[key], depth + 1)
    }
    return copy
  }

  return { value: visit(value, 0), truncated }
}
