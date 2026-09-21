import {
  DEFAULT_SECURITY_SETTINGS,
  type BrowserCookieImportResult,
  type SecuritySettings
} from '../../shared/security.js'
import { errorMessage } from '../error-message.js'

/**
 * State behind the Settings → Security tab, kept apart from React so its load, optimistic
 * write, rollback, and cookie-import paths are testable with a fake API. The panel subscribes
 * through `useSyncExternalStore`; nothing here touches `window`.
 */

export type SecurityApi = {
  get: () => Promise<SecuritySettings>
  set: (patch: Partial<SecuritySettings>) => Promise<SecuritySettings>
  importCookies: () => Promise<BrowserCookieImportResult>
}

export type SecurityPanelState = {
  settings: SecuritySettings
  /** True once the first `get` has answered; controls show defaults until then. */
  loaded: boolean
  /** The last failed operation's reason, cleared by the next success. */
  error: string | null
  importing: boolean
  /** Sentence describing the last cookie import, shown beside the Import now button. */
  importResult: string | null
}

export type SecurityController = {
  getState: () => SecurityPanelState
  subscribe: (listener: () => void) => () => void
  /** Read the current settings; a stale answer (from a superseded load) is dropped. */
  load: () => Promise<void>
  /** Apply the patch at once, then persist it; a refusal restores the previous values. */
  update: (patch: Partial<SecuritySettings>) => Promise<void>
  importCookies: () => Promise<void>
}

export const SECURITY_API_UNAVAILABLE = 'Security settings are unavailable in this window.'

export function createSecurityController(api: SecurityApi | null | undefined): SecurityController {
  let state: SecurityPanelState = {
    settings: { ...DEFAULT_SECURITY_SETTINGS },
    loaded: false,
    error: null,
    importing: false,
    importResult: null
  }
  const listeners = new Set<() => void>()
  let loadEpoch = 0

  const commit = (patch: Partial<SecurityPanelState>): void => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  const load = async (): Promise<void> => {
    const epoch = ++loadEpoch
    if (!api) {
      commit({ error: SECURITY_API_UNAVAILABLE })
      return
    }
    try {
      const settings = await api.get()
      if (epoch !== loadEpoch) return
      commit({ settings, loaded: true, error: null })
    } catch (cause) {
      if (epoch !== loadEpoch) return
      commit({ error: errorMessage(cause, 'Security settings could not be read.') })
    }
  }

  const update = async (patch: Partial<SecuritySettings>): Promise<void> => {
    if (!api) {
      commit({ error: SECURITY_API_UNAVAILABLE })
      return
    }
    const previous = pick(state.settings, patch)
    commit({ settings: { ...state.settings, ...patch }, error: null })
    try {
      const settings = await api.set(patch)
      commit({ settings, loaded: true })
    } catch (cause) {
      // Restore only the keys this write touched, so a concurrent write elsewhere survives.
      commit({
        settings: { ...state.settings, ...previous },
        error: errorMessage(cause, 'The setting could not be saved.')
      })
    }
  }

  const importCookies = async (): Promise<void> => {
    if (state.importing) return
    if (!api) {
      commit({ error: SECURITY_API_UNAVAILABLE })
      return
    }
    commit({ importing: true, importResult: null, error: null })
    try {
      const result = await api.importCookies()
      commit({ importing: false, importResult: describeCookieImport(result) })
    } catch (cause) {
      commit({ importing: false, error: errorMessage(cause, 'Cookies could not be imported.') })
    }
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load,
    update,
    importCookies
  }
}

/** One sentence for the inline result: what came from where, and how many were refused. */
export function describeCookieImport(result: BrowserCookieImportResult): string {
  if (!result.source) return 'No supported browser found'
  const cookies = `${result.imported} cookie${result.imported === 1 ? '' : 's'}`
  const sentence = `Imported ${cookies} from ${result.source}`
  return result.failed > 0 ? `${sentence} (${result.failed} failed)` : sentence
}

function pick(settings: SecuritySettings, patch: Partial<SecuritySettings>): Partial<SecuritySettings> {
  const previous: Partial<SecuritySettings> = {}
  for (const key of Object.keys(patch) as Array<keyof SecuritySettings>) {
    (previous as Record<string, unknown>)[key] = settings[key]
  }
  return previous
}
