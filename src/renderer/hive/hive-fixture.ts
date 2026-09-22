import type { ChatProvider } from '../../shared/chat.js'

export type HiveRunSummary = {
  id: string
  name: string
  status: 'running' | 'completed' | 'paused'
  unitCount: number
}

export type HiveUnit = {
  id: string
  title: string
  column: 'queued' | 'running' | 'review' | 'done'
  provider?: ChatProvider
  providerLabel?: string
  worktree?: string
  role?: string
  badge?: 'running' | 'judging' | 'merged' | 'queued'
}

export type HiveWorker = {
  id: string
  provider: ChatProvider
  unitTitle: string
  worktree: string
  state: 'running' | 'review' | 'idle'
  runtime: string
  selected?: boolean
}

export const HIVE_RUNS: HiveRunSummary[] = [
  { id: 'run-1', name: 'refactor auth middleware', status: 'running', unitCount: 100 },
  { id: 'run-2', name: 'migrate tests to vitest', status: 'completed', unitCount: 42 },
  { id: 'run-3', name: 'docs sweep · API routes', status: 'paused', unitCount: 18 }
]

export const HIVE_UNITS: HiveUnit[] = [
  { id: 'u-52', title: 'Unit 52 · validate JWT refresh', column: 'queued', role: 'implement' },
  { id: 'u-53', title: 'Unit 53 · rate-limit middleware', column: 'queued', provider: 'codex', badge: 'queued' },
  { id: 'u-41', title: 'Unit 41 · extract session store', column: 'running', provider: 'claude', providerLabel: 'Claude Sonnet', worktree: 'wt-41', badge: 'running' },
  { id: 'u-44', title: 'Unit 44 · OpenAPI spec patch', column: 'running', provider: 'cursor', providerLabel: 'Cursor', worktree: 'wt-44', badge: 'running' },
  { id: 'u-48', title: 'Unit 48 · e2e login flow', column: 'running', provider: 'antigravity', providerLabel: 'Antigravity', badge: 'running' },
  { id: 'u-38', title: 'Unit 38 · best-of-3 pick', column: 'review', badge: 'judging' },
  { id: 'u-12', title: 'Unit 12 · cookie parser', column: 'done', badge: 'merged' }
]

export const HIVE_WORKERS: HiveWorker[] = [
  { id: 'w-7f2a', provider: 'claude', unitTitle: 'Unit 41 · session store', worktree: 'wt-41', state: 'running', runtime: '14:02', selected: true },
  { id: 'w-9c01', provider: 'cursor', unitTitle: 'Unit 44 · OpenAPI', worktree: 'wt-44', state: 'running', runtime: '08:31' },
  { id: 'w-3b88', provider: 'codex', unitTitle: 'Unit 38 · judge B-of-3', worktree: '—', state: 'review', runtime: '02:10' }
]

export const PROVIDER_CAPACITY: { provider: ChatProvider; label: string; active: number; max: number }[] = [
  { provider: 'codex', label: 'Codex', active: 6, max: 8 },
  { provider: 'claude', label: 'Claude', active: 3, max: 6 },
  { provider: 'cursor', label: 'Cursor', active: 2, max: 2 },
  { provider: 'antigravity', label: 'Antigravity', active: 1, max: 4 }
]
