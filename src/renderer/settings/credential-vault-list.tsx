import { useState, type JSX } from 'react'
import { Check, CheckCircle2, Copy, Eye, EyeOff, Lock, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { credentialDomain, credentialService, type CredentialSummary } from '../../shared/credentials.js'
import { errorMessage } from '../error-message.js'
import { CREDENTIAL_SERVICE_LOGOS, RemoteServiceLogo } from './credential-service-logos.js'
import type { PendingRemoval } from './credential-vault-store.js'

export type CredentialVaultListProps = {
  credentials: CredentialSummary[]
  loading: boolean
  error: string | null
  migrated: number
  encryptionAvailable: boolean
  backend: string
  onAdd: () => void
  /** Hides the card and starts the undo window; the vault removes it when that elapses. */
  onRemove: (id: string) => void
  onUndoRemove: (id: string) => void
  pendingRemovals: PendingRemoval[]
  removeErrors: Record<string, string>
  reveal: (id: string, fieldId: string) => Promise<string>
}

/**
 * The vault as a card grid: one card per saved entry with its brand mark, masked
 * fields, and a dashed tile that starts a new one. Card geometry mirrors the
 * `settings-1` service block — 3px frame, 44px logo tile, state dot at top right.
 */
export function CredentialVaultList({
  credentials,
  loading,
  error,
  migrated,
  encryptionAvailable,
  backend,
  onAdd,
  onRemove,
  onUndoRemove,
  pendingRemovals,
  removeErrors,
  reveal
}: CredentialVaultListProps): JSX.Element {
  const hidden = new Set(pendingRemovals.map((entry) => entry.id))
  return (
    <div className="credential-list-content flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {encryptionAvailable ? (
          <>
            <Lock className="size-3.5 text-emerald-500" />
            <span>Encrypted by {backend}</span>
          </>
        ) : (
          <>
            <ShieldAlert className="size-3.5 text-amber-500" />
            <span>No OS keychain — secrets stored unencrypted</span>
          </>
        )}
        {loading && credentials.length === 0 ? <span>· Loading…</span> : null}
      </div>

      {migrated > 0 ? (
        <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          Moved {migrated} credential{migrated === 1 ? '' : 's'} out of browser storage into the encrypted vault.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      ) : null}

      {pendingRemovals.map((entry) => (
        <p
          key={entry.id}
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground"
        >
          <span>
            {entry.committing ? 'Removing ' : 'Removed '}
            <strong className="font-medium text-foreground">{entry.label}</strong>
            {entry.committing ? '…' : '.'}
          </span>
          {entry.committing ? null : (
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => onUndoRemove(entry.id)}>
              Undo
            </button>
          )}
        </p>
      ))}

      <div className="credential-grid-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="credential-grid">
          {credentials.filter((credential) => !hidden.has(credential.id)).map((credential) => (
            <CredentialCard
              key={credential.id}
              credential={credential}
              removeError={removeErrors[credential.id] ?? null}
              onRemove={onRemove}
              reveal={reveal}
            />
          ))}

          <button type="button" className="credential-add-tile" data-ui="credentials.add" onClick={onAdd}>
            <span className="credential-add-icon">
              <Plus className="size-[18px]" />
            </span>
            <span className="credential-add-title">Create new</span>
            <span className="credential-add-text">Add an API key or login by service URL</span>
          </button>
        </div>
      </div>
    </div>
  )
}

type CredentialCardProps = {
  credential: CredentialSummary
  /** Why the last removal of this entry failed, once it has come back to the grid. */
  removeError: string | null
  onRemove: (id: string) => void
  reveal: (id: string, fieldId: string) => Promise<string>
}

function CredentialCard({ credential, removeError, onRemove, reveal }: CredentialCardProps): JSX.Element {
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const Logo = CREDENTIAL_SERVICE_LOGOS[credential.serviceId]
  const description = credentialService(credential.serviceId)?.description ?? ''

  // Entries the catalog has no mark for wear the icon of the site they point at:
  // URL fields are stored readable, so the domain is already on this card.
  const brandless = !credentialService(credential.serviceId)?.domains
  const storedUrl = credential.fields.find((field) => field.kind === 'url')?.preview ?? ''
  const domain = brandless ? credentialDomain(storedUrl) : ''

  const toggleReveal = async (fieldId: string): Promise<void> => {
    if (revealed[fieldId] !== undefined) {
      setRevealed(({ [fieldId]: _hidden, ...rest }) => rest)
      return
    }
    try {
      const value = await reveal(credential.id, fieldId)
      setRevealed((current) => ({ ...current, [fieldId]: value }))
      setFailure(null)
    } catch (cause) {
      setFailure(errorMessage(cause, 'The secret could not be read.'))
    }
  }

  const copy = async (fieldId: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(await reveal(credential.id, fieldId))
      setCopied(fieldId)
      setFailure(null)
      setTimeout(() => setCopied(null), 2000)
    } catch (cause) {
      setFailure(errorMessage(cause, 'The secret could not be copied.'))
    }
  }

  return (
    <div className="credential-frame group" data-encrypted={credential.encrypted}>
      <div className="credential-panel">
        <span
          className="credential-state-dot"
          role="img"
          title={credential.encrypted ? 'Encrypted by the OS keychain' : 'Stored unencrypted'}
          aria-label={credential.encrypted ? 'Encrypted' : 'Unencrypted'}
        >
          {credential.encrypted ? <CheckCircle2 className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
        </span>

        <div className="credential-panel-body">
          <div className="credential-icon-tile">
            {domain ? <RemoteServiceLogo domain={domain} name={credential.label} /> : <Logo />}
          </div>

          <div className="credential-name-row">
            <h3 className="credential-name">{credential.label}</h3>
            <span className="credential-service-tag">{credential.serviceName}</span>
          </div>

          {description ? <p className="credential-card-description">{description}</p> : null}

          <div className="credential-summary">
            {credential.fields.map((field) => {
              const shown = revealed[field.id]
              const isSecret = field.kind === 'secret'
              return (
                <div key={field.id} className="credential-summary-row">
                  <span className="credential-summary-label">{field.label}</span>
                  <span className="credential-summary-value">{shown ?? field.preview}</span>
                  {isSecret ? (
                    <span className="credential-summary-actions">
                      <button
                        type="button"
                        data-ui="credentials.reveal"
                        data-ui-key={`${credential.id}.${field.id}`}
                        title={shown ? 'Hide' : 'Reveal'}
                        onClick={() => void toggleReveal(field.id)}
                      >
                        {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                      <button
                        type="button"
                        data-ui="credentials.copy"
                        data-ui-key={`${credential.id}.${field.id}`}
                        title="Copy"
                        onClick={() => void copy(field.id)}
                      >
                        {copied === field.id ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                      </button>
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>

          {failure ? <p className="text-xs text-destructive" role="alert">{failure}</p> : null}
          {removeError ? <p className="text-xs text-destructive" role="alert">{removeError}</p> : null}

          <div className="credential-card-actions">
            <button
              type="button"
              className="credential-card-remove"
              data-ui="credentials.delete"
              data-ui-key={credential.id}
              onClick={() => onRemove(credential.id)}
            >
              <Trash2 className="size-3.5" />
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
