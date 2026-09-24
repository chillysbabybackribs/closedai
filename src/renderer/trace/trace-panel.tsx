import type { JSX } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'

import { Button } from '../../components/ui/button.js'
import type { TraceKind } from '../../shared/trace.js'
import { TRACE_KINDS, useTraceController, type TraceTurnGroup } from './trace-controller.js'
import { TracePerformanceSummary } from './trace-performance-summary.js'
import { duration, TraceRow } from './trace-row.js'

export type TracePanelProps = {
  /** The view tab is in front; a hidden panel stops polling. */
  active: boolean
  /** The pane whose turns the panel shows unless every pane is requested. */
  paneId: string
}

const KIND_LABELS: Record<TraceKind, string> = {
  turn: 'Turns',
  tool: 'Tool calls',
  event: 'Transcript events',
  raw: 'Raw provider lines',
  note: 'Provider notes'
}

/**
 * The live turn trace: everything the main process saw the model do on this pane, newest turn
 * first, each entry expandable to its full payload. In memory only; gone at restart. Lives in a
 * Trace view tab (chat-layout/workspace-view.tsx), which owns the scope chip above it.
 */
export function TracePanel({ active, paneId }: TracePanelProps): JSX.Element {
  const trace = useTraceController(active, paneId)
  const shown = trace.groups.reduce((count, group) => count + group.entries.length, 0)

  return (
      <div className="trace-panel">
        <header className="trace-panel-header">
          <div>
            <h2 className="trace-panel-title">Turn trace</h2>
            <p className="trace-panel-description">
              {`${shown} of ${trace.total} entries shown${trace.dropped > 0 ? ` · ${trace.dropped} oldest evicted` : ''}${trace.loadedFull ? '' : ' · Refresh loads full history'} · in memory only, cleared at restart`}
            </p>
          </div>
          <div className="trace-panel-header-actions">
            <Button type="button" variant="ghost" size="sm" data-ui="trace.refresh" onClick={() => void trace.refresh({ full: true })}>
              <RefreshCw aria-hidden="true" /> Refresh
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={trace.total === 0} data-ui="trace.clear" onClick={() => void trace.clear()}>
              <Trash2 aria-hidden="true" /> Clear
            </Button>
          </div>
        </header>

        <div className="trace-panel-filters" role="group" aria-label="Trace filters">
          {TRACE_KINDS.map((kind) => (
            <label key={kind} className="trace-panel-filter">
              <input type="checkbox" data-ui="trace.filter" data-ui-key={kind} checked={trace.kinds.has(kind)} onChange={() => trace.toggleKind(kind)} />
              <span>{KIND_LABELS[kind]}</span>
            </label>
          ))}
          <span className="trace-panel-filter-spacer" />
          <label className="trace-panel-filter">
            <input type="checkbox" data-ui="trace.filter" data-ui-key="all-panes" checked={trace.allPanes} onChange={(event) => trace.setAllPanes(event.target.checked)} />
            <span>All chats</span>
          </label>
        </div>

        {trace.error && <p className="trace-panel-error" role="alert">{trace.error}</p>}

        <div className="trace-panel-list">
          {trace.groups.map((group) => <TraceTurn key={`${group.turnId ?? 'between'}-${group.entries[0]!.seq}`} group={group} />)}
          {trace.loaded && trace.groups.length === 0 && (
            <p className="trace-panel-empty">
              {trace.total === 0 ? 'Nothing traced yet. Send a message and the turn appears here as it runs.' : 'Nothing matches the current filters.'}
            </p>
          )}
        </div>

        <footer className="trace-panel-footer">
          Tool calls carry full arguments and results. Raw lines are the exact JSON exchanged with the provider process, with each entry capped at 48 KB.
        </footer>
      </div>
  )
}

function TraceTurn({ group }: { group: TraceTurnGroup }): JSX.Element {
  const failed = group.entries.some((entry) => entry.ok === false)
  const running = group.turnId !== null && group.durationMs === null && !group.entries.some((entry) => entry.label === 'turn.end')
  return (
    <section className={`trace-turn${failed ? ' trace-turn-failed' : ''}`} aria-label={group.turnId ?? 'between turns'}>
      <h3 className="trace-turn-title">
        <span className="trace-turn-name">{group.turnId ?? 'between turns'}</span>
        <span className="trace-turn-meta">
          {group.entries.length} entr{group.entries.length === 1 ? 'y' : 'ies'}
          {group.durationMs !== null ? ` · ${duration(group.durationMs)}` : running ? ' · running' : ''}
          {failed ? ' · has failures' : ''}
        </span>
      </h3>
      {group.turnId !== null && <TracePerformanceSummary value={group.performance} />}
      <ul className="trace-turn-rows">
        {group.entries.map((entry) => <TraceRow key={entry.seq} entry={entry} turnStartedAt={group.startedAt} />)}
      </ul>
    </section>
  )
}
