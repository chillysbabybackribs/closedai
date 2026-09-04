import { useState, type FormEvent, type JSX } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, Lock, ShieldAlert, UserRound } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Input } from '../../components/ui/input.js'
import { cn } from '../../lib/utils.js'
import type { CredentialDraft, CredentialSummary } from '../../shared/credentials.js'

type CredentialType = 'api-key' | 'login'

export type CredentialCreateFormProps = {
  onCancel: () => void
  onSaved: (saved: CredentialSummary) => void
  save: (draft: CredentialDraft) => Promise<CredentialSummary>
  encryptionAvailable: boolean
}

/** A single-page editor for the two credential shapes people use most often. */
export function CredentialCreateForm({
  onCancel,
  onSaved,
  save,
  encryptionAvailable
}: CredentialCreateFormProps): JSX.Element {
  const [type, setType] = useState<CredentialType>('api-key')
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [secret, setSecret] = useState('')
  const [secretVisible, setSecretVisible] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const missingLabel = !label.trim()
  const missingUsername = type === 'login' && !username.trim()
  const missingSecret = !secret.trim()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setShowErrors(true)
    setError(null)
    if (missingLabel || missingUsername || missingSecret) return

    setSaving(true)
    try {
      const saved = await save({
        serviceId: 'custom',
        label: label.trim(),
        values: {
          url: url.trim(),
          username: type === 'login' ? username.trim() : '',
          secret
        }
      })
      onSaved(saved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="credential-create-form flex min-h-0 flex-1 flex-col" onSubmit={(event) => void handleSubmit(event)}>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-xl flex-col gap-5">
          <div>
            <h2 className="text-base font-semibold">Create credential</h2>
            <p className="mt-1 text-sm text-muted-foreground">Save an API key or an account login for the app and its agents.</p>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Credential type</legend>
            <div className="credential-type-picker" role="radiogroup" aria-label="Credential type">
              <TypeButton
                type="api-key"
                selected={type === 'api-key'}
                icon={<KeyRound />}
                title="API key"
                description="Token, secret, or access key"
                onSelect={setType}
              />
              <TypeButton
                type="login"
                selected={type === 'login'}
                icon={<UserRound />}
                title="Login"
                description="Username and password"
                onSelect={setType}
              />
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="credential-label" required error={showErrors && missingLabel ? 'Name is required.' : undefined}>
              <Input
                id="credential-label"
                data-ui="credentials.label"
                value={label}
                placeholder={type === 'login' ? 'GitHub account' : 'Production API key'}
                aria-invalid={showErrors && missingLabel}
                autoFocus
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>

            <Field label="Website or service URL" htmlFor="credential-url" help="Optional">
              <Input
                id="credential-url"
                data-ui="credentials.field"
                data-ui-key="custom.url"
                type="url"
                value={url}
                placeholder="https://example.com"
                autoComplete="url"
                spellCheck={false}
                onChange={(event) => setUrl(event.target.value)}
              />
            </Field>

            {type === 'login' ? (
              <Field
                label="Username or email"
                htmlFor="credential-username"
                required
                error={showErrors && missingUsername ? 'Username or email is required.' : undefined}
              >
                <Input
                  id="credential-username"
                  data-ui="credentials.field"
                  data-ui-key="custom.username"
                  value={username}
                  placeholder="name@example.com"
                  aria-invalid={showErrors && missingUsername}
                  autoComplete="username"
                  spellCheck={false}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </Field>
            ) : null}

            <Field
              label={type === 'login' ? 'Password' : 'API key'}
              htmlFor="credential-secret"
              required
              error={showErrors && missingSecret ? `${type === 'login' ? 'Password' : 'API key'} is required.` : undefined}
            >
              <div className="relative">
                <Input
                  id="credential-secret"
                  data-ui="credentials.field"
                  data-ui-key="custom.secret"
                  type={secretVisible ? 'text' : 'password'}
                  value={secret}
                  placeholder={type === 'login' ? 'Enter password' : 'Paste API key'}
                  aria-invalid={showErrors && missingSecret}
                  autoComplete={type === 'login' ? 'current-password' : 'off'}
                  spellCheck={false}
                  className="pr-9 font-mono"
                  onChange={(event) => setSecret(event.target.value)}
                />
                <button
                  type="button"
                  data-ui="credentials.peek"
                  data-ui-key="custom.secret"
                  className="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={secretVisible ? `Hide ${type === 'login' ? 'password' : 'API key'}` : `Show ${type === 'login' ? 'password' : 'API key'}`}
                  onClick={() => setSecretVisible((current) => !current)}
                >
                  {secretVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
            </Field>
          </div>

          <div
            className={cn(
              'flex items-start gap-2 rounded-lg border p-3 text-xs',
              encryptionAvailable
                ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400'
            )}
          >
            {encryptionAvailable ? <Lock className="mt-px size-3.5 shrink-0" /> : <ShieldAlert className="mt-px size-3.5 shrink-0" />}
            <p>
              {encryptionAvailable
                ? 'The secret is encrypted with your OS keychain before it is written to disk.'
                : 'No OS keychain is available, so this secret will be stored unencrypted.'}
            </p>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t px-6 py-3">
        <Button type="button" variant="outline" size="sm" data-ui="credentials.cancel" onClick={onCancel}>
          Cancel
        </Button>
        <div className="flex min-w-0 items-center gap-3">
          {error ? <p className="truncate text-xs text-destructive">{error}</p> : null}
          <Button type="submit" size="sm" data-ui="credentials.save" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Lock />}
            {saving ? 'Saving…' : 'Save credential'}
          </Button>
        </div>
      </div>
    </form>
  )
}

type TypeButtonProps = {
  type: CredentialType
  selected: boolean
  icon: JSX.Element
  title: string
  description: string
  onSelect: (type: CredentialType) => void
}

function TypeButton({ type, selected, icon, title, description, onSelect }: TypeButtonProps): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-ui="credentials.type"
      data-ui-key={type}
      className={cn('credential-type-option', selected && 'credential-type-option-selected')}
      onClick={() => onSelect(type)}
    >
      <span className="credential-type-icon">{icon}</span>
      <span className="min-w-0 text-left">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

type FieldProps = {
  label: string
  htmlFor: string
  required?: boolean
  help?: string
  error?: string
  children: JSX.Element
}

function Field({ label, htmlFor, required, help, error, children }: FieldProps): JSX.Element {
  return (
    <div role="group" data-slot="field" className="flex w-full flex-col gap-2">
      <label htmlFor={htmlFor} className="flex w-fit items-center gap-1 text-sm font-medium">
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  )
}
