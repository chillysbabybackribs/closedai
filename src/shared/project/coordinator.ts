import type { ChatProvider } from '../chat.js'

/** Provider thread bound to a project after the user confirms the coordinator at build time. */
export type CoordinatorBinding = {
  provider: ChatProvider
  modelId: string
  reasoningEffort: string | null
  threadId: string | null
}

export type HiveWorkerRole = {
  id: string
  model: string
  tools: string[]
}

/** Declarative hive layout; repo-local overrides merge over defaults in main. */
export type HiveConfig = {
  version: 1
  workers: {
    maxConcurrent: number
    defaultProvider: ChatProvider | 'auto'
    roles: HiveWorkerRole[]
  }
  dispatch: { mode: 'rolling'; replanAfterAmendment: boolean }
}

export function defaultHiveConfig(): HiveConfig {
  return {
    version: 1,
    workers: {
      maxConcurrent: 4,
      defaultProvider: 'auto',
      roles: [
        { id: 'implement', model: 'auto', tools: ['read', 'edit', 'shell'] },
        { id: 'research', model: 'auto', tools: ['search', 'browser'] }
      ]
    },
    dispatch: { mode: 'rolling', replanAfterAmendment: true }
  }
}
