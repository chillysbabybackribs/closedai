import type { JSX } from 'react'
import { useState } from 'react'
import {
  CalendarDays,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Filter,
  PlayCircle,
  Plus,
  Search
} from 'lucide-react'
import { RunStatusBadge } from './run-status-badge.js'
import {
  attentionRunCount,
  filterRuns,
  type OperationsRun,
  type RunStatus,
  type RunTab
} from './operations-data.js'
import { RunsTable } from './runs-table.js'
import type { OperationsView } from './operations-sidebar.js'

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

function Metrics({ runs }: { runs: OperationsRun[] }): JSX.Element {
  return (
    <section className="ops-metrics" aria-label="Run overview">
      <Metric label="Needs attention" value={String(attentionRunCount(runs))} meta="Approval required" tone="attention" />
      <Metric label="Running" value={String(runs.filter((run) => run.status === 'running').length)} meta="Across active workspaces" tone="running" />
      <Metric label="Queued" value={String(runs.filter((run) => run.status === 'queued').length)} meta="Starting soon" tone="queued" />
      <Metric label="Completed today" value={String(runs.filter((run) => run.status === 'completed').length)} meta="Successful runs" tone="completed" />
    </section>
  )
}

function PageHeading({
  title,
  description,
  action
}: {
  title: string
  description: string
  action?: JSX.Element
}): JSX.Element {
  return (
    <div className="ops-page-heading">
      <div><h1>{title}</h1><p>{description}</p></div>
      {action}
    </div>
  )
}

function NewWorkerButton({ onNewWorker }: { onNewWorker: () => void }): JSX.Element {
  return <button type="button" className="ops-primary-button" onClick={onNewWorker}><Plus size={14} />New worker</button>
}

function SummaryRow({ run, onOpenRun }: { run: OperationsRun; onOpenRun: (id: number) => void }): JSX.Element {
  return (
    <button type="button" className="ops-summary-row" onClick={() => onOpenRun(run.id)}>
      <span><strong>{run.task}</strong><small>{run.worker} · {run.activity}</small></span>
      <RunStatusBadge status={run.status} />
    </button>
  )
}

function OverviewView({ runs, onNewWorker, onOpenRun }: ViewProps): JSX.Element {
  const attentionRuns = runs.filter((run) => run.status === 'attention' || run.status === 'failed')
  return (
    <>
      <div className="ops-breadcrumb"><strong>Overview</strong></div>
      <PageHeading title="Overview" description="See what is running, what needs attention, and what happened recently." action={<NewWorkerButton onNewWorker={onNewWorker} />} />
      <Metrics runs={runs} />
      <div className="ops-overview-grid">
        <section className="ops-summary-panel">
          <header><div><strong>Needs attention</strong><span>{attentionRuns.length} runs</span></div><CircleAlert size={15} /></header>
          {attentionRuns.length > 0
            ? attentionRuns.slice(0, 4).map((run) => <SummaryRow key={run.id} run={run} onOpenRun={onOpenRun} />)
            : <div className="ops-summary-empty"><CheckCircle2 size={18} /><span>No approvals are waiting.</span></div>}
        </section>
        <section className="ops-summary-panel">
          <header><div><strong>Recent runs</strong><span>{runs.length} total</span></div><PlayCircle size={15} /></header>
          {runs.slice(0, 5).map((run) => <SummaryRow key={run.id} run={run} onOpenRun={onOpenRun} />)}
        </section>
      </div>
    </>
  )
}

function RunsView({ runs, onNewWorker, onOpenRun }: ViewProps): JSX.Element {
  const [tab, setTab] = useState<RunTab>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [dateRange, setDateRange] = useState('Last 7 days')
  const [dateOpen, setDateOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const visibleRuns = filterRuns(runs, tab, search)
  return (
    <>
      <div className="ops-breadcrumb"><span>Operations</span><span>/</span><strong>Runs</strong></div>
      <PageHeading title="Runs" description="Monitor long-running work and intervene when an agent needs you." action={<NewWorkerButton onNewWorker={onNewWorker} />} />
      <Metrics runs={runs} />
      <div className="ops-tab-row">
        <div className="ops-tabs" role="tablist" aria-label="Run status">
          {RUN_TABS.map((item) => <button type="button" role="tab" key={item.id} className={tab === item.id ? 'is-active' : ''} aria-selected={tab === item.id} onClick={() => { setTab(item.id); setSelected([]) }}>{item.label}{item.id === 'attention' ? <span>{attentionRunCount(runs)}</span> : null}</button>)}
        </div>
        <div className="ops-toolbar">
          <label className="ops-search"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search runs" /><kbd>⌘K</kbd></label>
          <div className="ops-filter-wrap">
            <button type="button" className={dateOpen ? 'is-pressed' : ''} onClick={() => { setDateOpen(!dateOpen); setFiltersOpen(false) }}><CalendarDays size={13} />{dateRange}<ChevronDown size={12} /></button>
            {dateOpen ? <div className="ops-filter-popover"><strong>Date range</strong>{['Today', 'Last 7 days', 'Last 30 days'].map((range) => <button type="button" key={range} className={dateRange === range ? 'is-selected' : ''} onClick={() => { setDateRange(range); setDateOpen(false) }}><CalendarDays size={13} />{range}</button>)}</div> : null}
          </div>
          <div className="ops-filter-wrap">
            <button type="button" className={filtersOpen ? 'is-pressed' : ''} onClick={() => { setFiltersOpen(!filtersOpen); setDateOpen(false) }}><Filter size={13} />Filters<ChevronDown size={12} /></button>
            {filtersOpen ? <div className="ops-filter-popover"><strong>Quick filters</strong><button type="button" onClick={() => { setTab('attention'); setFiltersOpen(false) }}><CircleAlert size={13} />Needs attention</button><button type="button" onClick={() => { setTab('running'); setFiltersOpen(false) }}><PlayCircle size={13} />Running now</button><button type="button" onClick={() => { setTab('all'); setFiltersOpen(false) }}>Clear filters</button></div> : null}
          </div>
        </div>
      </div>
      <RunsTable runs={visibleRuns} tab={tab} selected={selected} onSelectedChange={setSelected} onOpenRun={onOpenRun} />
    </>
  )
}

function ApprovalsView({ runs, onOpenRun }: ViewProps): JSX.Element {
  const approvals = runs.filter((run) => run.status === 'attention' || run.status === 'failed')
  return (
    <>
      <div className="ops-breadcrumb"><span>Operations</span><span>/</span><strong>Approvals</strong></div>
      <PageHeading title="Approvals" description="Review runs that need a decision before work can continue." />
      <div className="ops-approval-callout"><CircleAlert size={16} /><span><strong>{approvals.length} runs need your attention.</strong> Open a run to inspect the checkpoint and choose an action.</span></div>
      <RunsTable runs={approvals} tab="attention" selected={[]} onSelectedChange={() => {}} onOpenRun={onOpenRun} />
    </>
  )
}

function SchedulesView(): JSX.Element {
  return (
    <>
      <div className="ops-breadcrumb"><span>Operations</span><span>/</span><strong>Schedules</strong></div>
      <PageHeading title="Schedules" description="Plan recurring workers and keep routine work moving." />
      <section className="ops-schedule-empty"><span><CalendarClock size={22} /></span><strong>No schedules yet</strong><p>Recurring worker schedules will appear here once scheduling is connected to the Operations runtime.</p><button type="button" disabled title="Scheduling is not connected yet">Create schedule</button></section>
    </>
  )
}

type ViewProps = {
  runs: OperationsRun[]
  onNewWorker: () => void
  onOpenRun: (id: number) => void
}

export function OperationsViewContent({ view, runs, onNewWorker, onOpenRun }: { view: OperationsView; runs: OperationsRun[]; onNewWorker: () => void; onOpenRun: (id: number) => void }): JSX.Element {
  if (view === 'overview') return <OverviewView runs={runs} onNewWorker={onNewWorker} onOpenRun={onOpenRun} />
  if (view === 'approvals') return <ApprovalsView runs={runs} onOpenRun={onOpenRun} />
  if (view === 'schedules') return <SchedulesView />
  return <RunsView runs={runs} onNewWorker={onNewWorker} onOpenRun={onOpenRun} />
}
