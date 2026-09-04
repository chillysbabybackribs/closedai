import { useEffect, useState, type JSX } from 'react'
import { ArrowLeft, KeyRound } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '../../components/ui/dialog.js'
import { CredentialVaultList } from './credential-vault-list.js'
import { CredentialWizard } from './credential-wizard.js'
import { useCredentialVault } from './credential-vault-store.js'

export type CredentialVaultModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The credential vault: a list of saved entries and a three-step wizard for adding one.
 * Storage is the OS-keychain-backed main-process vault; this component only ever holds
 * masked previews plus whatever single field the user explicitly reveals.
 */
export function CredentialVaultModal({ open, onOpenChange }: CredentialVaultModalProps): JSX.Element {
  const vault = useCredentialVault(open)
  const [view, setView] = useState<'list' | 'wizard'>('list')

  useEffect(() => {
    if (open) setView('list')
  }, [open])

  const openDocs = (url: string): void => {
    void window.closedai?.browser?.openTab(url)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-ui="dialog.credentials"
        className="credential-dialog appearance-dialog"
        aria-describedby="credential-description"
      >
        <div className="appearance-dialog-heading">
          {view === 'wizard' ? (
            <Button
              variant="ghost"
              size="icon"
              data-ui="credentials.cancel"
              className="appearance-dialog-icon h-8 w-8 border-0 p-0 !rounded-full"
              aria-label="Back to the credential list"
              onClick={() => setView('list')}
            >
              <ArrowLeft size={16} />
            </Button>
          ) : (
            <div className="appearance-dialog-icon">
              <KeyRound size={18} />
            </div>
          )}
          <div>
            <DialogTitle className="appearance-dialog-title">
              {view === 'wizard' ? 'Add credential' : 'Credential Vault'}
            </DialogTitle>
            <DialogDescription id="credential-description">
              {view === 'wizard'
                ? 'Pick the services, enter their keys, then review and save.'
                : 'API keys and logins the app and its agents can use, encrypted by your OS keychain.'}
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
            onAdd={() => setView('wizard')}
            onRemove={vault.remove}
            reveal={vault.reveal}
          />
        ) : (
          <CredentialWizard
            save={vault.save}
            encryptionAvailable={vault.status?.encryptionAvailable ?? false}
            onOpenDocs={openDocs}
            onCancel={() => setView('list')}
            onSaved={() => setView('list')}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
