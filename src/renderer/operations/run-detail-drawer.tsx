import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  FileText,
  MessageSquareText,
  Pause,
  PlayCircle,
  RotateCcw,
  Square,
  X
} from 'lucide-react'
import { RUN_STATUS_LABELS, type OperationsRun, type RunStatus } from './operations-data.js'
import { RunStatusBadge } from './run-status-badge.js'

const DETAIL_TABS = ['Overview', 'Activity', 'Artifacts', 'Browser', 'Logs', 'Configuration'] as const
type DetailTab = typeof DETAIL_TABS[number]

export function RunDetailDrawer({
  run,
  onClose,
  onMessage,
  onStatusChange,
  interactive = true,
  escapeEnabled = true
}: {
  run: OperationsRun
  onClose: () => void
  onMessage: () => void
  onStatusChange: (status: RunStatus) => void
  interactive?: boolean
  escapeEnabled?: boolean
}): JSX.Element {
  const [tab, setTab] = useState<DetailTab>('Overview')
  useEffect(() => {
    if (!escapeEnabled) return undefined
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [escapeEnabled, onClose])

  return (
    <>
      <button type="button" className="ops-scrim" onClick={onClose} aria-label="Close run detail" />
      <aside className="ops-drawer" role="dialog" aria-modal="true" aria-labelledby="run-detail-title">
        <header>
          <div>
            <span className="ops-eyebrow">Run detail</span>
            <h2 id="run-detail-title">{run.task}</h2>
            <p>{run.worker} · {run.workspace}{run.modelId ? ` · ${run.modelId}` : ''}</p>
          </div>
          <button type="button" className="ops-icon-button" onClick={onClose} aria-label="Close run detail">
            <X size={16} />
          </button>
        </header>
        <div className="ops-drawer-status">
          <RunStatusBadge status={run.status} /><span>Run #0{run.id}84</span>
        </div>
        <div className="ops-detail-tabs" role="tablist" aria-label="Run detail sections">
          {DETAIL_TABS.map((item) => (
            <button
              type="button"
              role="tab"
              key={item}
              aria-selected={tab === item}
              className={tab === item ? 'is-active' : ''}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="ops-drawer-content">
          {tab === 'Overview' ? <RunOverview run={run} /> : <DetailPlaceholder tab={tab} />}
        </div>
        <footer>
          <button type="button" disabled={!interactive} onClick={() => onStatusChange('paused')}><Pause size={13} />Pause</button>
          <button type="button" disabled={!interactive} onClick={() => onStatusChange('queued')}><RotateCcw size={13} />Rerun</button>
          <button type="button" className="is-danger" disabled={!interactive} onClick={() => onStatusChange('failed')}>
            <Square size={12} />Stop
          </button>
          <button type="button" className="ops-primary-button" disabled={!interactive} onClick={onMessage}>
            <MessageSquareText size={14} />Message worker
          </button>
        </footer>
      </aside>
    </>
  )
}

function RunOverview({ run }: { run: OperationsRun }): JSX.Element {
  return (
    <>
      <section className="ops-run-progress">
        <span>Current checkpoint</span><strong>{run.checkpoint}</strong>
        <div><span /></div><small>{run.status === 'running' ? 'Codex is processing this run' : RUN_STATUS_LABELS[run.status]}</small>
      </section>
      <dl className="ops-run-facts">
        <div><dt>Worker</dt><dd>{run.worker}</dd></div>
        <div><dt>Workspace</dt><dd>{run.workspace}</dd></div>
        <div><dt>Model</dt><dd>{run.modelId ?? 'Not assigned'}</dd></div>
        <div><dt>Runtime</dt><dd>{run.runtime}</dd></div>
        <div><dt>Last activity</dt><dd>{run.activity}</dd></div>
      </dl>
      <section className="ops-activity-list">
        <h3>Latest activity</h3>
        <div><PlayCircle size={15} fill="currentColor" /><p><strong>{run.checkpoint}</strong><span>{run.modelId ? `Using ${run.modelId}` : 'No model assigned'}</span></p></div>
        <div><CheckCircle2 size={15} fill="currentColor" /><p><strong>{RUN_STATUS_LABELS[run.status]}</strong><span>Last activity: {run.activity}</span></p></div>
      </section>
    </>
  )
}

function DetailPlaceholder({ tab }: { tab: Exclude<DetailTab, 'Overview'> }): JSX.Element {
  const copy = tab === 'Browser'
    ? 'The worker’s live browser session and recent navigation will appear here.'
    : `Run ${tab.toLowerCase()} are available for inspection in this view.`
  return (
    <section className="ops-detail-placeholder">
      <span><FileText size={15} /></span><strong>{tab}</strong><p>{copy}</p>
    </section>
  )
}
