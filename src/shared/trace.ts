import type { ChatProvider } from './chat.js'

// The live turn trace: everything the main process saw a model do, in order, for the user to
// read when a turn goes wrong. Held in memory only and gone at restart; nothing is written to
// disk. Entries carry full detail (prompts, tool arguments, results, raw provider lines) capped
// per entry so one huge payload cannot crowd out the rest.

export type TraceKind =
  /** A turn opening or closing on a pane. */
  | 'turn'
  /** A registry tool call: one entry when it starts, one when it returns. */
  | 'tool'
  /** A normalized transcript item or context update the pane received. */
  | 'event'
  /** One raw line between the app and the provider process, either direction. */
  | 'raw'

export type TraceEntry = {
  /** Monotonic across the process; the renderer orders and de-duplicates by it. */
  seq: number
  /** Unix milliseconds. */
  at: number
  paneId: string | null
  provider: ChatProvider | null
  turnId: string | null
  kind: TraceKind
  /** Short fixed label, e.g. `turn.start`, `tool.result`, `codex.in`. */
  label: string
  /** One line of what happened, for scanning the list without expanding. */
  summary: string
  /** For raw entries: `in` is provider → app, `out` is app → provider. */
  direction?: 'in' | 'out'
  /** Set on entries that close something: a tool result or a turn end. */
  durationMs?: number
  /** Set when the entry has a success/failure meaning. */
  ok?: boolean
  /** Full detail as text (JSON when structured), truncated at the per-entry cap. */
  detail: string
  truncated: boolean
}

export type TraceSnapshot = {
  entries: TraceEntry[]
  /** Entries evicted from the ring since the last clear. */
  dropped: number
  capacity: number
}

export type TraceEvent =
  | { type: 'entry'; entry: TraceEntry }
  | { type: 'cleared' }
