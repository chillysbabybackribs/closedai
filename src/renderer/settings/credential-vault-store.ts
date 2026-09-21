import { useCallback, useEffect, useRef, useState } from 'react'
import type { CredentialDraft, CredentialSummary, CredentialVaultStatus } from '../../shared/credentials.js'
import { errorMessage } from '../error-message.js'

/**
 * Renderer-side access to the main-process vault, plus the one-time move of entries the
 * earlier vault kept in localStorage. Secrets are never held here in bulk: the list holds
 * masked previews and each reveal or copy asks the main process for that one field.
 */

const LEGACY_KEY = 'closedai-credentials'

/** How long a removed entry stays recoverable before the vault is asked to forget it. */
export const REMOVE_UNDO_MS = 6000

export type PendingRemoval = {
  id: string
  label: string
  /** True once the vault call is in flight; Undo is no longer offered. */
  committing: boolean
}

type LegacyCredential = {
  id?: string
  name?: string
  type?: string
  url?: string
  username?: string
  secret?: string
}

export type CredentialVaultState = {
  credentials: CredentialSummary[]
  status: CredentialVaultStatus | null
  loading: boolean
  error: string | null
  /** How many entries were lifted out of localStorage on first open, if any. */
  migrated: number
  refresh: () => Promise<void>
  save: (draft: CredentialDraft) => Promise<CredentialSummary>
  /** Hide the entry now; the vault forgets it after REMOVE_UNDO_MS or when the panel closes. */
  remove: (id: string) => void
  /** Bring a hidden entry back before its removal is committed. */
  undoRemove: (id: string) => void
  pendingRemovals: PendingRemoval[]
  /** Why an entry could not be removed, keyed by id; the card shows it when it comes back. */
  removeErrors: Record<string, string>
  reveal: (id: string, fieldId: string) => Promise<string>
}

export function useCredentialVault(open: boolean): CredentialVaultState {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([])
  const [status, setStatus] = useState<CredentialVaultStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [migrated, setMigrated] = useState(0)
  const [pendingRemovals, setPendingRemovals] = useState<PendingRemoval[]>([])
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({})
  const removeTimers = useRef(new Map<string, number>())
  const credentialsRef = useRef(credentials)
  credentialsRef.current = credentials

  const refresh = useCallback(async () => {
    const api = window.closedai?.credentials
    if (!api) {
      setError('Credential vault is unavailable in this window.')
      return
    }
    setLoading(true)
    try {
      const [list, vaultStatus] = await Promise.all([api.list(), api.status()])
      setCredentials(list)
      setStatus(vaultStatus)
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause, 'The credential vault could not be read.'))
    } finally {
      setLoading(false)
    }
  }, [])

  // The migration and the first read belong to one open; a close/reopen before they settle
  // must not apply a stale result or run the legacy import twice.
  const openEpoch = useRef(0)
  useEffect(() => {
    if (!open) return
    const current = ++openEpoch.current
    setError(null)
    setRemoveErrors({})
    void (async () => {
      const moved = await migrateLegacyCredentialsOnce()
      if (current !== openEpoch.current) return
      setMigrated(moved)
      await refresh()
    })()
    return () => { openEpoch.current++ }
  }, [open, refresh])

  const save = useCallback(
    async (draft: CredentialDraft) => {
      const api = requireApi()
      const saved = await api.save(draft)
      await refresh()
      return saved
    },
    [refresh]
  )

  const commitRemove = useCallback(async (id: string) => {
    removeTimers.current.delete(id)
    setPendingRemovals((current) => current.map((entry) => entry.id === id ? { ...entry, committing: true } : entry))
    try {
      await requireApi().remove(id)
      await refresh()
    } catch (cause) {
      setRemoveErrors((current) => ({ ...current, [id]: errorMessage(cause, 'The credential could not be removed.') }))
    } finally {
      setPendingRemovals((current) => current.filter((entry) => entry.id !== id))
    }
  }, [refresh])

  const remove = useCallback((id: string) => {
    if (removeTimers.current.has(id)) return
    const label = credentialsRef.current.find((credential) => credential.id === id)?.label ?? 'credential'
    setRemoveErrors(({ [id]: _cleared, ...rest }) => rest)
    setPendingRemovals((current) => [...current, { id, label, committing: false }])
    removeTimers.current.set(id, window.setTimeout(() => { void commitRemove(id) }, REMOVE_UNDO_MS))
  }, [commitRemove])

  const undoRemove = useCallback((id: string) => {
    const timer = removeTimers.current.get(id)
    if (timer === undefined) return
    window.clearTimeout(timer)
    removeTimers.current.delete(id)
    setPendingRemovals((current) => current.filter((entry) => entry.id !== id))
  }, [])

  // Closing the panel (or unmounting it) is the end of the undo window: commit what is pending.
  const flushRemovals = useCallback(() => {
    for (const [id, timer] of removeTimers.current) {
      window.clearTimeout(timer)
      void commitRemove(id)
    }
  }, [commitRemove])
  useEffect(() => {
    if (!open) flushRemovals()
  }, [open, flushRemovals])
  useEffect(() => flushRemovals, [flushRemovals])

  const reveal = useCallback((id: string, fieldId: string) => requireApi().reveal(id, fieldId), [])

  return {
    credentials, status, loading, error, migrated, refresh, save,
    remove, undoRemove, pendingRemovals, removeErrors, reveal
  }
}

/**
 * One migration at a time: a close/reopen while the import is still writing shares the same
 * run instead of starting a second one that would re-save every legacy entry.
 */
let migration: Promise<number> | null = null
function migrateLegacyCredentialsOnce(): Promise<number> {
  migration ??= migrateLegacyCredentials().finally(() => { migration = null })
  return migration
}

function requireApi(): NonNullable<Window['closedai']>['credentials'] {
  const api = window.closedai?.credentials
  if (!api) throw new Error('Credential vault is unavailable in this window.')
  return api
}

/**
 * Move any entries the previous localStorage vault held into the encrypted store. The
 * localStorage copy is cleared only after every entry has been written, so a failure
 * part-way leaves the original data in place to retry.
 */
async function migrateLegacyCredentials(): Promise<number> {
  const api = window.closedai?.credentials
  if (!api) return 0
  const raw = localStorage.getItem(LEGACY_KEY)
  if (!raw) return 0

  let legacy: LegacyCredential[]
  try {
    legacy = JSON.parse(raw) as LegacyCredential[]
  } catch {
    return 0
  }
  if (!Array.isArray(legacy) || legacy.length === 0) {
    localStorage.removeItem(LEGACY_KEY)
    return 0
  }

  let moved = 0
  try {
    for (const entry of legacy) {
      const secret = entry.secret?.trim()
      if (!secret) continue
      await api.save({
        serviceId: 'custom',
        label: entry.name?.trim() || 'Imported credential',
        values: { url: entry.url?.trim() ?? '', username: entry.username?.trim() ?? '', secret }
      })
      moved += 1
    }
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // Keep the localStorage copy: the next open retries, and duplicates are visible.
  }
  return moved
}
