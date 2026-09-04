import { useEffect, useState, type JSX } from 'react'
import { KeyRound } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '../../components/ui/dialog.js'
import { CredentialVaultList } from './credential-vault-list.js'
import { CredentialCreateForm } from './credential-create-form.js'
import { useCredentialVault } from './credential-vault-store.js'

export type CredentialVaultModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The credential vault: a list of saved entries and an in-place editor for adding one.
 * Storage is the OS-keychain-backed main-process vault; this component only ever holds
 * masked previews plus whatever single field the user explicitly reveals.
 */
export function CredentialVaultModal({ open, onOpenChange }: CredentialVaultModalProps): JSX.Element {
  const vault = useCredentialVault(open)
  const [view, setView] = useState<'list' | 'create'>('list')

  useEffect(() => {
    if (open) setView('list')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-ui="dialog.credentials"
        className="credential-dialog appearance-dialog"
        aria-describedby="credential-description"
      >
        <div className="appearance-dialog-heading">
          <div className="appearance-dialog-icon">
            <KeyRound size={18} />
          </div>
          <div>
            <DialogTitle className="appearance-dialog-title">Credential Vault</DialogTitle>
            <DialogDescription id="credential-description">
              API keys and logins the app and its agents can use, encrypted by your OS keychain.
            </DialogDescription>
          </div>
        </div>

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
            reveal={vault.reveal}
          />
        ) : (
          <CredentialCreateForm
            save={vault.save}
            encryptionAvailable={vault.status?.encryptionAvailable ?? false}
            onCancel={() => setView('list')}
            onSaved={() => setView('list')}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
