import { useEffect, useState, type JSX } from 'react'
import { CredentialVaultList } from './credential-vault-list.js'
import { CredentialCreateForm } from './credential-create-form.js'
import { useCredentialVault } from './credential-vault-store.js'

export type CredentialVaultPanelProps = {
  /** The panel loads the vault only while its tab is shown. */
  active: boolean
}

/**
 * The Credentials tab of Settings: a list of saved entries and an in-place editor for adding
 * one. Storage is the OS-keychain-backed main-process vault; this component only ever holds
 * masked previews plus whatever single field the user explicitly reveals.
 */
export function CredentialVaultPanel({ active }: CredentialVaultPanelProps): JSX.Element {
  const vault = useCredentialVault(active)
  const [view, setView] = useState<'list' | 'create'>('list')

  useEffect(() => {
    if (active) setView('list')
  }, [active])

  return (
    <div className="settings-panel credential-panel" data-ui="dialog.credentials">
      {view === 'list' ? (
        <CredentialVaultList
          credentials={vault.credentials}
          loading={vault.loading}
          error={vault.error}
          migrated={vault.migrated}
          encryptionAvailable={vault.status?.encryptionAvailable ?? false}
          backend={vault.status?.backend ?? 'the OS keychain'}
          onAdd={() => setView('create')}
          onRemove={vault.remove}
          onUndoRemove={vault.undoRemove}
          pendingRemovals={vault.pendingRemovals}
          removeErrors={vault.removeErrors}
          reveal={vault.reveal}
          onAgentAccess={vault.setAgentAccess}
        />
      ) : (
        <CredentialCreateForm
          save={vault.save}
          encryptionAvailable={vault.status?.encryptionAvailable ?? false}
          onCancel={() => setView('list')}
          onSaved={() => setView('list')}
        />
      )}
    </div>
  )
}
