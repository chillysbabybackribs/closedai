import type { ChatModel } from './chat.js'

export type RunStatus = 'attention' | 'completed' | 'failed' | 'paused' | 'queued' | 'running'

export type OperationsRun = {
  id: number
  task: string
  worker: string
  workspace: string
  modelId: string | null
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
