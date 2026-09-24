import { useSyncExternalStore } from 'react'
import type { AgentRun, AgentRunsEvent } from '../../shared/agent-runs.js'

// The renderer's view of every agent run, keyed by chat id. Main pushes the whole list on any
// change; the first subscriber also asks for the current list, so a pane opened after a run
// started still finds it. Kept apart from React so the priming and event paths are testable.

export type AgentRunsApi = {
  list: () => Promise<AgentRun[]>
  onEvent: (listener: (event: AgentRunsEvent) => void) => () => void
}

export type AgentRunsStore = {
  subscribe(listener: () => void): () => void
  get(chatId: string): AgentRun | null
  runs(): readonly AgentRun[]
}

export function createAgentRunsStore(api: AgentRunsApi): AgentRunsStore {
  let runs: readonly AgentRun[] = []
  let byChat = new Map<string, AgentRun>()
  let primed = false
  let unsubscribe: (() => void) | null = null
  const listeners = new Set<() => void>()
  const replace = (next: readonly AgentRun[]): void => {
    runs = next
    byChat = new Map(next.map((run) => [run.chatId, run]))
    for (const listener of listeners) listener()
  }
  const prime = (): void => {
    if (primed) return
    primed = true
    unsubscribe = api.onEvent((event) => replace(event.runs))
    void api.list().then(replace).catch(() => { primed = false; unsubscribe?.(); unsubscribe = null })
  }
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      prime()
      return () => { listeners.delete(listener) }
    },
    get: (chatId) => byChat.get(chatId) ?? null,
    runs: () => runs
  }
}

let shared: AgentRunsStore | null = null

function sharedStore(): AgentRunsStore {
  shared ??= createAgentRunsStore(window.closedai.agentRuns)
  return shared
}

const NO_RUNS: readonly AgentRun[] = []

/** Every run, running or paused, in main's order; re-renders whenever any run changes. */
export function useAgentRuns(): readonly AgentRun[] {
  const store = typeof window === 'undefined' || !window.closedai ? null : sharedStore()
  return useSyncExternalStore(
    store ? store.subscribe : () => () => {},
    () => store?.runs() ?? NO_RUNS,
    () => NO_RUNS
  )
}

/** The run driving this pane, or null; re-renders only when that run's record changes. */
export function useAgentRun(chatId: string): AgentRun | null {
  const store = typeof window === 'undefined' || !window.closedai ? null : sharedStore()
  return useSyncExternalStore(
    store ? store.subscribe : () => () => {},
    () => store?.get(chatId) ?? null,
    () => null
  )
}
