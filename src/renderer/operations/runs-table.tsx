import type { JSX, MouseEvent } from 'react'
import { MoreHorizontal, Pause, Search, Square } from 'lucide-react'
import type { OperationsRun, RunTab } from './operations-data.js'
import { workspaceTone } from './operations-data.js'
import { RunStatusBadge } from './run-status-badge.js'

function RunRow({
  run,
  selected,
  onSelect,
  onOpen
}: {
  run: OperationsRun
  selected: boolean
  onSelect: (id: number) => void
  onOpen: (id: number) => void
}): JSX.Element {
  function stopRow(event: MouseEvent): void {
    event.stopPropagation()
  }
  return (
    <tr onClick={() => onOpen(run.id)}>
      <td className="ops-check" onClick={stopRow}>
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${run.task}`}
          onChange={() => onSelect(run.id)}
        />
      </td>
      <td><strong>{run.task}</strong><span>{run.worker}</span></td>
      <td>
        <span className="ops-workspace-cell">
          <span className="ops-workspace-icon" data-tone={workspaceTone(run.workspace)}>
            {run.workspace[0].toUpperCase()}
          </span>
          {run.workspace}
        </span>
      </td>
      <td><span className="ops-checkpoint">{run.checkpoint}</span></td>
      <td><RunStatusBadge status={run.status} /></td>
      <td className="ops-runtime">{run.runtime}</td>
      <td className="ops-muted">{run.activity}</td>
      <td onClick={stopRow}>
        <button type="button" className="ops-icon-button" aria-label={`Actions for ${run.task}`}>
          <MoreHorizontal size={16} />
        </button>
      </td>
    </tr>
  )
}

function tabLabel(tab: RunTab): string {
  if (tab === 'all') return 'All runs'
  if (tab === 'attention') return 'Attention runs'
  return `${tab[0].toUpperCase()}${tab.slice(1)} runs`
}

export function RunsTable({
  runs,
  tab,
  selected,
  onSelectedChange,
  onOpenRun
}: {
  runs: OperationsRun[]
  tab: RunTab
  selected: number[]
  onSelectedChange: (selected: number[]) => void
  onOpenRun: (id: number) => void
}): JSX.Element {
  const allVisibleSelected = runs.length > 0 && runs.every((run) => selected.includes(run.id))
  function toggleOne(id: number): void {
    onSelectedChange(selected.includes(id)
      ? selected.filter((selectedId) => selectedId !== id)
      : [...selected, id])
  }
  return (
    <section className="ops-table-card" aria-label="Runs table">
      <div className="ops-table-title">
        <div><strong>{tabLabel(tab)}</strong><span>{runs.length} runs</span></div>
        {selected.length > 0 ? (
          <div className="ops-bulk-actions">
            <span>{selected.length} selected</span>
            <button type="button"><Pause size={12} />Pause</button>
            <button type="button"><Square size={11} />Stop</button>
          </div>
        ) : null}
        <button type="button" className="ops-icon-button" aria-label="More table actions">
          <MoreHorizontal size={16} />
        </button>
      </div>
      <div className="ops-table-scroll">
        <table>
          <thead>
            <tr>
              <th className="ops-check">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  aria-label="Select visible runs"
                  onChange={() => onSelectedChange(allVisibleSelected ? [] : runs.map((run) => run.id))}
                />
              </th>
              <th>Task</th><th>Workspace</th><th>Current checkpoint</th><th>Status</th>
              <th>Runtime</th><th>Last activity</th><th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                selected={selected.includes(run.id)}
                onSelect={toggleOne}
                onOpen={onOpenRun}
              />
            ))}
          </tbody>
        </table>
        {runs.length === 0 ? (
          <div className="ops-empty">
            <Search size={24} /><strong>No matching runs</strong><span>Try a different search or filter.</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
