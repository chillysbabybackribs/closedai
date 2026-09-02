import type { JSX } from 'react'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

import type { TraceEntry } from '../../shared/trace.js'

export type TraceRowProps = {
  entry: TraceEntry
  /** Start of the turn the entry belongs to, for the relative offset column. */
  turnStartedAt: number
}

/** One trace entry: a scannable line that expands to the full detail. */
export function TraceRow({ entry, turnStartedAt }: TraceRowProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const status = entry.ok === undefined ? '' : entry.ok ? ' trace-row-ok' : ' trace-row-failed'
  return (
    <li className={`trace-row trace-row-${entry.kind}${status}`}>
      <button type="button" className="trace-row-line" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <ChevronRight className={`trace-row-chevron size-3${open ? ' trace-row-chevron-open' : ''}`} aria-hidden="true" />
        <span className="trace-row-time" title={new Date(entry.at).toISOString()}>{clock(entry.at)}</span>
        <span className="trace-row-offset">{offset(entry.at - turnStartedAt)}</span>
        <span className="trace-row-kind">{entry.kind}</span>
        <span className="trace-row-label">
          {entry.direction === 'in' ? '← ' : entry.direction === 'out' ? '→ ' : ''}{entry.label}
        </span>
        <span className="trace-row-summary">{entry.summary}</span>
        {entry.durationMs !== undefined && <span className="trace-row-duration">{duration(entry.durationMs)}</span>}
        {entry.provider && <span className="trace-row-provider">{entry.provider}</span>}
      </button>
      {open && (
        <pre className="trace-row-detail">
          {entry.detail}
          {entry.truncated && <span className="trace-row-truncated">{'\n'}(detail truncated at the trace cap)</span>}
        </pre>
      )}
    </li>
  )
}

function clock(at: number): string {
  const date = new Date(at)
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

function offset(ms: number): string {
  if (ms < 0) return ''
  return `+${duration(ms)}`
}

export function duration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`
}
