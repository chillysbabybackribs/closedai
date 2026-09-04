import { useCallback, useEffect, useState } from 'react'
import type { CredentialDraft, CredentialSummary, CredentialVaultStatus } from '../../shared/credentials.js'

/**
 * Renderer-side access to the main-process vault, plus the one-time move of entries the
 * earlier vault kept in localStorage. Secrets are never held here in bulk: the list holds
 * masked previews and each reveal or copy asks the main process for that one field.
 */

const LEGACY_KEY = 'closedai-credentials'

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
  remove: (id: string) => Promise<void>
  reveal: (id: string, fieldId: string) => Promise<string>
}

export function useCredentialVault(open: boolean): CredentialVaultState {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([])
  const [status, setStatus] = useState<CredentialVaultStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [migrated, setMigrated] = useState(0)

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
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void (async () => {
      const moved = await migrateLegacyCredentials()
      setMigrated(moved)
      await refresh()
    })()
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

  const remove = useCallback(
    async (id: string) => {
      await requireApi().remove(id)
      await refresh()
    },
    [refresh]
  )

  const reveal = useCallback((id: string, fieldId: string) => requireApi().reveal(id, fieldId), [])

  return { credentials, status, loading, error, migrated, refresh, save, remove, reveal }
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
