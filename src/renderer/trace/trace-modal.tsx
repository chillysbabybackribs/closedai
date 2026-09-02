import type { JSX } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'

import { Button } from '../../components/ui/button.js'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog.js'
import type { TraceKind } from '../../shared/trace.js'
import { TRACE_KINDS, useTraceController, type TraceTurnGroup } from './trace-controller.js'
import { duration, TraceRow } from './trace-row.js'

export type TraceModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The pane whose turns the panel shows unless every pane is requested. */
  paneId: string
}

const KIND_LABELS: Record<TraceKind, string> = {
  turn: 'Turns',
  tool: 'Tool calls',
  event: 'Transcript events',
  raw: 'Raw provider lines'
}

/**
 * The live turn trace: everything the main process saw the model do on this pane, newest turn
 * first, each entry expandable to its full payload. In memory only; gone at restart.
 */
export function TraceModal({ open, onOpenChange, paneId }: TraceModalProps): JSX.Element {
  const trace = useTraceController(open, paneId)
  const shown = trace.groups.reduce((count, group) => count + group.entries.length, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="trace-modal" aria-describedby="trace-modal-description">
        <header className="trace-modal-header">
          <div>
            <DialogTitle>Turn trace</DialogTitle>
            <DialogDescription id="trace-modal-description">
              {`${shown} of ${trace.total} entries shown${trace.dropped > 0 ? ` · ${trace.dropped} oldest evicted` : ''} · in memory only, cleared at restart`}
            </DialogDescription>
          </div>
          <div className="trace-modal-header-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => void trace.refresh()}>
              <RefreshCw aria-hidden="true" /> Refresh
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={trace.total === 0} onClick={() => void trace.clear()}>
              <Trash2 aria-hidden="true" /> Clear
            </Button>
          </div>
        </header>

        <div className="trace-modal-filters" role="group" aria-label="Trace filters">
          {TRACE_KINDS.map((kind) => (
            <label key={kind} className="trace-modal-filter">
              <input type="checkbox" checked={trace.kinds.has(kind)} onChange={() => trace.toggleKind(kind)} />
              <span>{KIND_LABELS[kind]}</span>
            </label>
          ))}
          <span className="trace-modal-filter-spacer" />
          <label className="trace-modal-filter">
            <input type="checkbox" checked={trace.allPanes} onChange={(event) => trace.setAllPanes(event.target.checked)} />
            <span>All panes</span>
          </label>
        </div>

        {trace.error && <p className="trace-modal-error" role="alert">{trace.error}</p>}

        <div className="trace-modal-list">
          {trace.groups.map((group) => <TraceTurn key={`${group.turnId ?? 'between'}-${group.entries[0]!.seq}`} group={group} />)}
          {trace.groups.length === 0 && (
            <p className="trace-modal-empty">
              {trace.total === 0 ? 'Nothing traced yet. Send a message and the turn appears here as it runs.' : 'Nothing matches the current filters.'}
            </p>
          )}
        </div>

        <footer className="trace-modal-footer">
          Tool calls carry full arguments and results. Raw lines are the exact JSON exchanged with the provider process, with each entry capped at 48 KB.
        </footer>
      </DialogContent>
    </Dialog>
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
      <ul className="trace-turn-rows">
        {group.entries.map((entry) => <TraceRow key={entry.seq} entry={entry} turnStartedAt={group.startedAt} />)}
      </ul>
    </section>
  )
}
