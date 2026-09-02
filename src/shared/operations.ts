import type { ChatModel } from './chat.js'

export type RunStatus = 'attention' | 'completed' | 'failed' | 'paused' | 'queued' | 'running'

export type OperationsRun = {
  id: number
  task: string
  worker: string
  workspace: string
  modelId: string | null
  threadId: string | null
  turnId: string | null
  checkpoint: string
  status: RunStatus
  runtime: string
  activity: string
}

export type OperationsSnapshot = {
  runs: OperationsRun[]
}

export type OperationsModelCatalog = {
  models: ChatModel[]
  selectedModel: string | null
}

export type OperationsEvent = {
  type: 'runs'
  runs: OperationsRun[]
}

export const DEFAULT_OPERATIONS_RUNS: OperationsRun[] = [
  { id: 1, task: 'Implement OAuth refresh handling', worker: 'Frontend maintainer', workspace: 'closedai', modelId: null, threadId: null, turnId: null, checkpoint: 'Running verification suite', status: 'running', runtime: '18m 42s', activity: 'Now' },
  { id: 2, task: 'Review Dropbox cleanup flow', worker: 'Safety reviewer', workspace: 'closedai', modelId: null, threadId: null, turnId: null, checkpoint: 'Waiting for approval', status: 'attention', runtime: '1h 14m', activity: '3m ago' },
  { id: 3, task: 'Audit browser tab lifecycle', worker: 'Reliability worker', workspace: 'closedai', modelId: null, threadId: null, turnId: null, checkpoint: 'Queued behind build', status: 'queued', runtime: '—', activity: '8m ago' },
  { id: 4, task: 'Prepare weekly release notes', worker: 'Release operator', workspace: 'desktop', modelId: null, threadId: null, turnId: null, checkpoint: 'Published summary', status: 'completed', runtime: '7m 09s', activity: '24m ago' },
  { id: 5, task: 'Fix flaky CDP navigation test', worker: 'Test repair worker', workspace: 'closedai', modelId: null, threadId: null, turnId: null, checkpoint: 'Test failed on retry 3', status: 'failed', runtime: '31m 20s', activity: '41m ago' },
  { id: 6, task: 'Refresh tool documentation', worker: 'Docs maintainer', workspace: 'platform', modelId: null, threadId: null, turnId: null, checkpoint: 'Paused after source scan', status: 'paused', runtime: '12m 03s', activity: '1h ago' }
]
