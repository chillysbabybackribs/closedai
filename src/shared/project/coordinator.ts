import type { ChatProvider } from '../chat.js'

/** Provider thread bound to a project after the user confirms the coordinator at build time. */
export type CoordinatorBinding = {
  provider: ChatProvider
  modelId: string
  reasoningEffort: string | null
  threadId: string | null
  /** Chat pane the workspace runs the coordinator in; the run loop sends planning turns here. */
  paneId: string | null
}

/** `rolling` keeps the run loop dispatching; `paused` leaves running work alone and starts nothing. */
export type DispatchMode = 'rolling' | 'paused'

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
  dispatch: { mode: DispatchMode; replanAfterAmendment: boolean }
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
