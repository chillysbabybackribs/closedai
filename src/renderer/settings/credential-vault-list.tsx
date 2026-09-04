import { useState, type JSX } from 'react'
import { Check, Copy, Eye, EyeOff, Lock, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { cn } from '../../lib/utils.js'
import type { CredentialSummary } from '../../shared/credentials.js'
import { CREDENTIAL_SERVICE_LOGOS } from './credential-service-logos.js'

export type CredentialVaultListProps = {
  credentials: CredentialSummary[]
  loading: boolean
  error: string | null
  migrated: number
  encryptionAvailable: boolean
  backend: string
  onAdd: () => void
  onRemove: (id: string) => Promise<void>
  reveal: (id: string, fieldId: string) => Promise<string>
}

export function CredentialVaultList({
  credentials,
  loading,
  error,
  migrated,
  encryptionAvailable,
  backend,
  onAdd,
  onRemove,
  reveal
}: CredentialVaultListProps): JSX.Element {
  return (
    <div className="credential-list-content flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
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
        </div>
        <Button size="sm" data-ui="credentials.add" onClick={onAdd}>
          <Plus />
          Create credential
        </Button>
      </div>

      {migrated > 0 ? (
        <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          Moved {migrated} credential{migrated === 1 ? '' : 's'} out of browser storage into the encrypted vault.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      ) : null}

      {loading && credentials.length === 0 ? (
        <div className="credential-empty-state" aria-live="polite">
          <p>Loading credentials…</p>
        </div>
      ) : credentials.length === 0 ? (
        <div className="credential-empty-state">
          <p>Your vault is empty</p>
          <span className="text-xs text-muted-foreground">Create an API key or account login to get started.</span>
        </div>
      ) : (
        <div className="credential-list min-h-0 flex-1 overflow-y-auto">
          {credentials.map((credential) => (
            <CredentialRow key={credential.id} credential={credential} onRemove={onRemove} reveal={reveal} />
          ))}
        </div>
      )}
    </div>
  )
}

type CredentialRowProps = {
  credential: CredentialSummary
  onRemove: (id: string) => Promise<void>
  reveal: (id: string, fieldId: string) => Promise<string>
}

function CredentialRow({ credential, onRemove, reveal }: CredentialRowProps): JSX.Element {
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const Logo = CREDENTIAL_SERVICE_LOGOS[credential.serviceId]

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
      setFailure(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const copy = async (fieldId: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(await reveal(credential.id, fieldId))
      setCopied(fieldId)
      setFailure(null)
      setTimeout(() => setCopied(null), 2000)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="credential-item group">
      <div className="credential-item-icon [&_svg]:size-5">
        <Logo />
      </div>

      <div className="credential-item-details">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{credential.label}</span>
          <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase text-secondary-foreground">
            {credential.serviceName}
          </span>
          {credential.encrypted ? null : (
            <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-600 dark:text-amber-400">
              Unencrypted
            </span>
          )}
        </div>

        <div className="mt-1.5 flex flex-col gap-1">
          {credential.fields.map((field) => {
            const shown = revealed[field.id]
            const isSecret = field.kind === 'secret'
            return (
              <div key={field.id} className="flex items-center gap-2 text-xs">
                <span className="w-28 shrink-0 truncate text-muted-foreground">{field.label}</span>
                <span className={cn('truncate rounded bg-muted px-1.5 py-0.5 font-mono', isSecret && 'select-all')}>
                  {shown ?? field.preview}
                </span>
                {isSecret ? (
                  <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      data-ui="credentials.reveal"
                      data-ui-key={`${credential.id}.${field.id}`}
                      className="rounded p-1 text-muted-foreground hover:bg-secondary"
                      title={shown ? 'Hide' : 'Reveal'}
                      onClick={() => void toggleReveal(field.id)}
                    >
                      {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                    <button
                      type="button"
                      data-ui="credentials.copy"
                      data-ui-key={`${credential.id}.${field.id}`}
                      className="rounded p-1 text-muted-foreground hover:bg-secondary"
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

        {failure ? <p className="mt-1 text-xs text-destructive">{failure}</p> : null}
      </div>

      <div className="credential-item-actions">
        <button
          type="button"
          data-ui="credentials.delete"
          data-ui-key={credential.id}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          title="Delete"
          onClick={() => void onRemove(credential.id)}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
