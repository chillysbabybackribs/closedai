export type RunTab = 'all' | 'attention' | 'completed' | 'running'
export type { OperationsRun, RunStatus } from '../../shared/operations.js'
import type { OperationsRun, RunStatus } from '../../shared/operations.js'
import { DEFAULT_OPERATIONS_RUNS } from '../../shared/operations.js'

export const OPERATIONS_RUNS_STORAGE_KEY = 'closedai.operations.runs'

export const INITIAL_RUNS: OperationsRun[] = DEFAULT_OPERATIONS_RUNS.map((run) => ({ ...run }))

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
    && (run.modelId === undefined || run.modelId === null || typeof run.modelId === 'string')
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
    return Array.isArray(parsed) && parsed.every(isOperationsRun)
      ? parsed.map((run) => ({ ...run, modelId: run.modelId ?? null }))
      : null
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
