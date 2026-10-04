import { useEffect, useSyncExternalStore } from 'react'
import { DEFAULT_PERFORMANCE_SETTINGS, type PerformanceSettings } from '../../shared/performance.js'
import { errorMessage } from '../error-message.js'

let state = { settings: DEFAULT_PERFORMANCE_SETTINGS, loaded: false, saving: false, error: null as string | null }
const listeners = new Set<() => void>()
let started = false
let revision = 0
let writeTail = Promise.resolve()
const snapshot = () => state
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const commit = (patch: Partial<typeof state>) => {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function load(): void {
  if (started) return
  started = true
  const api = window.closedai?.performance
  if (!api) { commit({ error: 'Performance settings are unavailable.' }); return }
  const atRevision = revision
  api.onSettingsChanged((settings) => { revision++; commit({ settings, loaded: true, error: null }) })
  void api.settings().then((settings) => {
    if (revision === atRevision) commit({ settings, loaded: true, error: null })
  }, (cause) => { commit({ error: errorMessage(cause) }) })
}

export function usePerformanceSettings() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(load, [])
  return current
}

/** Serialize user writes and let main broadcast the result to every window. */
export function updatePerformanceSettings(patch: Partial<PerformanceSettings>): Promise<void> {
  writeTail = writeTail.then(async () => {
    commit({ saving: true })
    try {
      const settings = await window.closedai.performance.update(patch)
      revision++
      commit({ settings, loaded: true, error: null })
    } catch (cause) {
      commit({ error: errorMessage(cause, 'The setting could not be saved.') })
    } finally { commit({ saving: false }) }
  })
  return writeTail
}
