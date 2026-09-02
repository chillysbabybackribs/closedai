export type RunStatus = 'attention' | 'completed' | 'failed' | 'paused' | 'queued' | 'running'
export type RunTab = 'all' | 'attention' | 'completed' | 'running'

export type OperationsRun = {
  id: number
  task: string
  worker: string
  workspace: string
  checkpoint: string
  status: RunStatus
  runtime: string
  activity: string
}

export const OPERATIONS_RUNS_STORAGE_KEY = 'closedai.operations.runs'

export const INITIAL_RUNS: OperationsRun[] = [
  {
    id: 1,
    task: 'Implement OAuth refresh handling',
    worker: 'Frontend maintainer',
    workspace: 'closedai',
    checkpoint: 'Running verification suite',
    status: 'running',
    runtime: '18m 42s',
    activity: 'Now'
  },
  {
    id: 2,
    task: 'Review Dropbox cleanup flow',
    worker: 'Safety reviewer',
    workspace: 'closedai',
    checkpoint: 'Waiting for approval',
    status: 'attention',
    runtime: '1h 14m',
    activity: '3m ago'
  },
  {
    id: 3,
    task: 'Audit browser tab lifecycle',
    worker: 'Reliability worker',
    workspace: 'closedai',
    checkpoint: 'Queued behind build',
    status: 'queued',
    runtime: '—',
    activity: '8m ago'
  },
  {
    id: 4,
    task: 'Prepare weekly release notes',
    worker: 'Release operator',
    workspace: 'desktop',
    checkpoint: 'Published summary',
    status: 'completed',
    runtime: '7m 09s',
    activity: '24m ago'
  },
  {
    id: 5,
    task: 'Fix flaky CDP navigation test',
    worker: 'Test repair worker',
    workspace: 'closedai',
    checkpoint: 'Test failed on retry 3',
    status: 'failed',
    runtime: '31m 20s',
    activity: '41m ago'
  },
  {
    id: 6,
    task: 'Refresh tool documentation',
    worker: 'Docs maintainer',
    workspace: 'platform',
    checkpoint: 'Paused after source scan',
    status: 'paused',
    runtime: '12m 03s',
    activity: '1h ago'
  }
]

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  attention: 'Needs attention',
  completed: 'Completed',
  failed: 'Failed',
  paused: 'Paused',
  queued: 'Queued',
  running: 'Running'
}

const RUN_STATUSES = new Set<RunStatus>(['attention', 'completed', 'failed', 'paused', 'queued', 'running'])

function isOperationsRun(value: unknown): value is OperationsRun {
  if (!value || typeof value !== 'object') return false
  const run = value as Partial<OperationsRun>
  return typeof run.id === 'number'
    && Number.isFinite(run.id)
    && typeof run.task === 'string'
    && typeof run.worker === 'string'
    && typeof run.workspace === 'string'
    && typeof run.checkpoint === 'string'
    && typeof run.status === 'string'
    && RUN_STATUSES.has(run.status as RunStatus)
    && typeof run.runtime === 'string'
    && typeof run.activity === 'string'
}

export function readOperationsRuns(storage: Pick<Storage, 'getItem'>): OperationsRun[] | null {
  try {
    const stored = storage.getItem(OPERATIONS_RUNS_STORAGE_KEY)
    if (!stored) return null
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed) && parsed.every(isOperationsRun) ? parsed : null
  } catch {
    return null
  }
}

export function persistOperationsRuns(storage: Pick<Storage, 'setItem'>, runs: OperationsRun[]): void {
  try {
    storage.setItem(OPERATIONS_RUNS_STORAGE_KEY, JSON.stringify(runs))
  } catch {
    // Storage can be unavailable in restricted browser contexts; the in-memory UI still works.
  }
}

export function attentionRunCount(runs: OperationsRun[]): number {
  return runs.filter((run) => run.status === 'attention' || run.status === 'failed').length
}

export function filterRuns(
  runs: OperationsRun[],
  tab: RunTab,
  search: string
): OperationsRun[] {
  const needle = search.trim().toLowerCase()
  return runs.filter((run) => {
    const matchesTab = tab === 'all' || (
      tab === 'attention'
        ? run.status === 'attention' || run.status === 'failed'
        : run.status === tab
    )
    if (!matchesTab || !needle) return matchesTab
    return `${run.task} ${run.worker} ${run.workspace} ${run.checkpoint}`
      .toLowerCase()
      .includes(needle)
  })
}

export function workspaceTone(workspace: string): 'blue' | 'green' | 'violet' {
  if (workspace === 'desktop') return 'blue'
  if (workspace === 'platform') return 'green'
  return 'violet'
}
