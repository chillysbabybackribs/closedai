import { useMemo, useState, type FormEvent, type JSX } from 'react'
import { ExternalLink, Loader2, Lock, ShieldAlert } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Input } from '../../components/ui/input.js'
import { cn } from '../../lib/utils.js'
import {
  credentialService,
  matchCredentialService,
  missingCredentialFields,
  type CredentialDraft,
  type CredentialServiceId,
  type CredentialSummary
} from '../../shared/credentials.js'
import { CredentialFieldRow } from './credential-field-row.js'
import { CredentialServicePicker } from './credential-service-picker.js'

export type CredentialCreateFormProps = {
  onCancel: () => void
  onSaved: (saved: CredentialSummary) => void
  save: (draft: CredentialDraft) => Promise<CredentialSummary>
  encryptionAvailable: boolean
}

/**
 * The create form: paste a service URL to pick the service, or choose it from the grid,
 * then fill the fields that service actually takes. The catalog in `shared/credentials`
 * decides both the field set and what is required, so this form and the main-process
 * store agree without either restating the rules.
 */
export function CredentialCreateForm({
  onCancel,
  onSaved,
  save,
  encryptionAvailable
}: CredentialCreateFormProps): JSX.Element {
  const [lookup, setLookup] = useState('')
  const [serviceId, setServiceId] = useState<CredentialServiceId>('api-key')
  const [label, setLabel] = useState('')
  const [labelTouched, setLabelTouched] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const service = credentialService(serviceId)!
  const match = useMemo(() => matchCredentialService(lookup), [lookup])
  const detectedDomain = match?.domain ?? ''
  const detectedName = match && !match.recognised ? match.label : ''

  const missing = useMemo(
    () => missingCredentialFields({ serviceId, label, values }),
    [serviceId, label, values]
  )
  const missingLabel = !label.trim()

  /** Typing a URL picks the service, names the entry, and fills any URL field it has. */
  const handleLookup = (text: string): void => {
    setLookup(text)
    const found = matchCredentialService(text)
    if (!found) return

    setServiceId(found.serviceId)
    if (!labelTouched) setLabel(found.label)

    const target = credentialService(found.serviceId)
    if (found.domain && target?.fields.some((field) => field.id === 'url')) {
      setValues((current) => ({ ...current, url: text.trim() }))
    }
  }

  const handleSelect = (id: CredentialServiceId): void => {
    setServiceId(id)
    if (labelTouched) return
    const picked = credentialService(id)
    setLabel(id === 'custom' && detectedName ? detectedName : (picked?.name ?? ''))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setShowErrors(true)
    setError(null)
    if (missingLabel || missing.length > 0) return

    setSaving(true)
    try {
      const kept = Object.fromEntries(
        service.fields.map((field) => [field.id, values[field.id]?.trim() ?? ''])
      )
      onSaved(await save({ serviceId, label: label.trim(), values: kept }))
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
            <p className="mt-1 text-sm text-muted-foreground">
              Paste the service URL to pick it automatically, or choose one below.
            </p>
          </div>

          <div role="group" data-slot="field" className="flex w-full flex-col gap-2">
            <label htmlFor="credential-lookup" className="flex w-fit items-center gap-1 text-sm font-medium">
              Service URL or name
            </label>
            <Input
              id="credential-lookup"
              data-ui="credentials.detect"
              value={lookup}
              placeholder="https://dashboard.stripe.com/apikeys"
              autoComplete="url"
              autoFocus
              spellCheck={false}
              onChange={(event) => handleLookup(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              <LookupHint domain={detectedDomain} recognised={match?.recognised ?? false} name={match?.label ?? ''} />
            </p>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Service</legend>
            <CredentialServicePicker
              selectedId={serviceId}
              detectedDomain={detectedDomain}
              detectedName={detectedName}
              onSelect={handleSelect}
            />
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div role="group" data-slot="field" className="flex w-full flex-col gap-2">
              <label htmlFor="credential-label" className="flex w-fit items-center gap-1 text-sm font-medium">
                Name
                <span className="text-destructive">*</span>
              </label>
              <Input
                id="credential-label"
                data-ui="credentials.label"
                value={label}
                placeholder={`${service.name} key`}
                aria-invalid={showErrors && missingLabel}
                onChange={(event) => {
                  setLabelTouched(true)
                  setLabel(event.target.value)
                }}
              />
              {showErrors && missingLabel ? (
                <p className="text-xs text-destructive">Name is required.</p>
              ) : (
                <p className="text-xs text-muted-foreground">How this entry appears in the vault.</p>
              )}
            </div>

            {service.fields.map((field) => (
              <CredentialFieldRow
                key={`${serviceId}.${field.id}`}
                serviceId={serviceId}
                field={field}
                value={values[field.id] ?? ''}
                error={
                  showErrors && missing.some((candidate) => candidate.id === field.id)
                    ? `${field.label} is required.`
                    : undefined
                }
                onChange={(next) => setValues((current) => ({ ...current, [field.id]: next }))}
              />
            ))}
          </div>

          {service.docsUrl ? (
            <button
              type="button"
              data-ui="credentials.docs"
              className="flex w-fit items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              onClick={() => void window.closedai.browser.navigate(service.docsUrl!).catch(() => {})}
            >
              <ExternalLink className="size-3.5" />
              Open where {service.name} issues this key
            </button>
          ) : null}

          <div
            className={cn(
              'flex items-start gap-2 rounded-lg border p-3 text-xs',
              encryptionAvailable
                ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400'
            )}
          >
            {encryptionAvailable ? (
              <Lock className="mt-px size-3.5 shrink-0" />
            ) : (
              <ShieldAlert className="mt-px size-3.5 shrink-0" />
            )}
            <p>
              {encryptionAvailable
                ? 'Secret fields are encrypted with your OS keychain before they are written to disk.'
                : 'No OS keychain is available, so secret fields will be stored unencrypted.'}
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

type LookupHintProps = { domain: string; recognised: boolean; name: string }

function LookupHint({ domain, recognised, name }: LookupHintProps): JSX.Element {
  if (recognised && name) return <>Recognised {name}.</>
  if (domain) return <>{domain} is not in the catalog — saving it as a Custom entry with its own icon.</>
  return <>A URL picks the service and its logo. A plain name works too.</>
}
