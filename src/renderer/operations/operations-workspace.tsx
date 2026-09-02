import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Filter,
  PlayCircle,
  Plus,
  Search
} from 'lucide-react'
import { NewWorkerDialog } from './new-worker-dialog.js'
import { filterRuns, INITIAL_RUNS, type OperationsRun, type RunStatus, type RunTab } from './operations-data.js'
import { OperationsSidebar } from './operations-sidebar.js'
import { RunDetailDrawer } from './run-detail-drawer.js'
import { RunsTable } from './runs-table.js'
import { WorkerChatDrawer } from './worker-chat-drawer.js'

const RUN_TABS: Array<{ id: RunTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'completed', label: 'Completed' }
]

function Metric({
  label,
  value,
  meta,
  tone
}: {
  label: string
  value: string
  meta: string
  tone: 'attention' | 'completed' | 'queued' | 'running'
}): JSX.Element {
  const Icon = tone === 'attention' ? CircleAlert : tone === 'running' ? PlayCircle : tone === 'completed' ? CheckCircle2 : Clock3
  return (
    <article className="ops-metric">
      <div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div>
      <span className="ops-metric-icon" data-tone={tone}><Icon size={14} /></span>
    </article>
  )
}

export function OperationsWorkspace(): JSX.Element {
  const [runs, setRuns] = useState(INITIAL_RUNS)
  const [tab, setTab] = useState<RunTab>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [newWorkerOpen, setNewWorkerOpen] = useState(false)
  const [dateRange, setDateRange] = useState('Last 7 days')
  const [dateOpen, setDateOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const visibleRuns = useMemo(() => filterRuns(runs, tab, search), [runs, search, tab])
  const selectedRun = selectedRunId === null ? null : runs.find((run) => run.id === selectedRunId) ?? null

  function updateSelectedStatus(status: RunStatus): void {
    if (selectedRunId === null) return
    setRuns((current) => current.map((run) => run.id === selectedRunId
      ? { ...run, status, checkpoint: status === 'paused' ? 'Paused by operator' : status === 'queued' ? 'Queued to rerun' : 'Stopped by operator' }
      : run))
  }

  function createWorker(task: string, workspace: string): void {
    const nextId = Math.max(...runs.map((run) => run.id), 0) + 1
    const run: OperationsRun = {
      id: nextId,
      task,
      worker: 'New worker',
      workspace,
      checkpoint: 'Queued for initialization',
      status: 'queued',
      runtime: '—',
      activity: 'Now'
    }
    setRuns((current) => [run, ...current])
    setTab('all')
    setSearch('')
    setNewWorkerOpen(false)
    setSelectedRunId(nextId)
  }

  return (
    <section className="operations-workspace" data-ui-surface="operations">
      <OperationsSidebar />
      <main className="ops-main">
        <div className="ops-breadcrumb"><span>Operations</span><span>/</span><strong>Runs</strong></div>
        <div className="ops-page-heading">
          <div><h1>Runs</h1><p>Monitor long-running work and intervene when an agent needs you.</p></div>
          <button type="button" className="ops-primary-button" onClick={() => setNewWorkerOpen(true)}><Plus size={14} />New worker</button>
        </div>
        <section className="ops-metrics" aria-label="Run overview">
          <Metric label="Needs attention" value="1" meta="Approval required" tone="attention" />
          <Metric label="Running" value="1" meta="Across 1 workspace" tone="running" />
          <Metric label="Queued" value="1" meta="Starting soon" tone="queued" />
          <Metric label="Completed today" value="12" meta="92% success rate" tone="completed" />
        </section>
        <div className="ops-tab-row">
          <div className="ops-tabs" role="tablist" aria-label="Run status">
            {RUN_TABS.map((item) => (
              <button
                type="button"
                role="tab"
                key={item.id}
                className={tab === item.id ? 'is-active' : ''}
                aria-selected={tab === item.id}
                onClick={() => { setTab(item.id); setSelected([]) }}
              >
                {item.label}{item.id === 'attention' ? <span>1</span> : null}
              </button>
            ))}
          </div>
          <div className="ops-toolbar">
            <label className="ops-search">
              <Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search runs" />
              <kbd>⌘K</kbd>
            </label>
            <div className="ops-filter-wrap">
              <button type="button" className={dateOpen ? 'is-pressed' : ''} onClick={() => { setDateOpen(!dateOpen); setFiltersOpen(false) }}>
                <CalendarDays size={13} />{dateRange}<ChevronDown size={12} />
              </button>
              {dateOpen ? (
                <div className="ops-filter-popover">
                  <strong>Date range</strong>
                  {['Today', 'Last 7 days', 'Last 30 days'].map((range) => (
                    <button type="button" key={range} className={dateRange === range ? 'is-selected' : ''} onClick={() => { setDateRange(range); setDateOpen(false) }}>
                      <CalendarDays size={13} />{range}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="ops-filter-wrap">
              <button type="button" className={filtersOpen ? 'is-pressed' : ''} onClick={() => { setFiltersOpen(!filtersOpen); setDateOpen(false) }}>
                <Filter size={13} />Filters<ChevronDown size={12} />
              </button>
              {filtersOpen ? (
                <div className="ops-filter-popover">
                  <strong>Quick filters</strong>
                  <button type="button" onClick={() => { setTab('attention'); setFiltersOpen(false) }}><CircleAlert size={13} />Needs attention</button>
                  <button type="button" onClick={() => { setTab('running'); setFiltersOpen(false) }}><PlayCircle size={13} />Running now</button>
                  <button type="button" onClick={() => { setTab('all'); setFiltersOpen(false) }}>Clear filters</button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <RunsTable runs={visibleRuns} tab={tab} selected={selected} onSelectedChange={setSelected} onOpenRun={setSelectedRunId} />
      </main>
      {selectedRun ? (
        <RunDetailDrawer
          run={selectedRun}
          onClose={() => setSelectedRunId(null)}
          onMessage={() => setChatOpen(true)}
          onStatusChange={updateSelectedStatus}
          escapeEnabled={!chatOpen}
        />
      ) : null}
      {chatOpen && selectedRun ? <WorkerChatDrawer run={selectedRun} onClose={() => setChatOpen(false)} /> : null}
      {newWorkerOpen ? <NewWorkerDialog onClose={() => setNewWorkerOpen(false)} onCreate={createWorker} /> : null}
    </section>
  )
}
