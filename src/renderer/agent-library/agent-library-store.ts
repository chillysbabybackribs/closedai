import { useSyncExternalStore } from 'react'
import type { SavedAgent } from '../../shared/agent-library.js'

// The renderer's copy of the saved-agent library. Main pushes the whole list on any change;
// the first subscriber also asks for the current list, so a dialog opened right after launch
// still finds it. Same shape as agent-runs-store so the two stay easy to read together.

export type AgentLibraryApi = {
  list: () => Promise<SavedAgent[]>
  onChanged: (listener: (agents: SavedAgent[]) => void) => () => void
}

export type AgentLibraryStore = {
  subscribe(listener: () => void): () => void
  agents(): readonly SavedAgent[]
}

export function createAgentLibraryStore(api: AgentLibraryApi): AgentLibraryStore {
  let agents: readonly SavedAgent[] = []
  let primed = false
  let unsubscribe: (() => void) | null = null
  const listeners = new Set<() => void>()
  const replace = (next: readonly SavedAgent[]): void => {
    agents = next
    for (const listener of listeners) listener()
  }
  const prime = (): void => {
    if (primed) return
    primed = true
    unsubscribe = api.onChanged(replace)
    void api.list().then(replace).catch(() => { primed = false; unsubscribe?.(); unsubscribe = null })
  }
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      prime()
      return () => { listeners.delete(listener) }
    },
    agents: () => agents
  }
}

let shared: AgentLibraryStore | null = null

function sharedStore(): AgentLibraryStore {
  shared ??= createAgentLibraryStore(window.closedai.agentLibrary)
  return shared
}

const EMPTY: readonly SavedAgent[] = []

/** Every saved agent, most recently used first; re-renders when the library changes. */
export function useAgentLibrary(): readonly SavedAgent[] {
  const store = typeof window === 'undefined' || !window.closedai ? null : sharedStore()
  return useSyncExternalStore(
    store ? store.subscribe : () => () => {},
    () => store?.agents() ?? EMPTY,
    () => EMPTY
  )
}
