import { useMemo, useState, type JSX } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Lock, ShieldAlert } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { cn } from '../../lib/utils.js'
import {
  CREDENTIAL_SERVICES,
  credentialService,
  maskSecret,
  type CredentialDraft,
  type CredentialServiceId,
  type CredentialServiceSpec,
  type CredentialSummary
} from '../../shared/credentials.js'
import { CredentialStepper, type StepperStep } from './credential-stepper.js'
import { CredentialFieldsStep, type CredentialDraftState } from './credential-fields-step.js'
import { ServiceSelectGrid } from './credential-import-services.js'
import { CREDENTIAL_SERVICE_LOGOS } from './credential-service-logos.js'

/**
 * Three-step add-credential flow: choose services, enter their credentials, review and
 * save. The step chrome follows the ReUI `wizard-1` block and the service grid is the
 * `settings-1` block; the save itself goes to the OS-encrypted main-process vault.
 */

type StepId = 'select' | 'details' | 'review'

const STEPS: readonly StepperStep<StepId>[] = [
  { id: 'select', title: 'Services' },
  { id: 'details', title: 'Credentials' },
  { id: 'review', title: 'Review' }
]

const MAX_SELECTIONS = 3

export type CredentialWizardProps = {
  onCancel: () => void
  onSaved: (saved: CredentialSummary[]) => void
  save: (draft: CredentialDraft) => Promise<CredentialSummary>
  /** False when the OS keychain is unavailable; the review step warns before saving. */
  encryptionAvailable: boolean
  onOpenDocs?: (url: string) => void
}

export function CredentialWizard({
  onCancel,
  onSaved,
  save,
  encryptionAvailable,
  onOpenDocs
}: CredentialWizardProps): JSX.Element {
  const [step, setStep] = useState<StepId>('select')
  const [selected, setSelected] = useState<CredentialServiceId[]>([])
  const [drafts, setDrafts] = useState<Record<string, CredentialDraftState>>({})
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const services = useMemo(
    () => selected.flatMap((id) => { const spec = credentialService(id); return spec ? [spec] : [] }),
    [selected]
  )

  const missingByService = useMemo(
    () =>
      services.flatMap((service) => {
        const values = drafts[service.id]?.values ?? {}
        const missing = service.fields.filter((field) => field.required && !values[field.id]?.trim())
        return missing.length > 0 ? [{ service, missing }] : []
      }),
    [services, drafts]
  )

  const canLeaveSelect = selected.length > 0
  const canLeaveDetails = missingByService.length === 0
  const reachable = useMemo<StepId[]>(() => {
    const ids: StepId[] = ['select']
    if (canLeaveSelect) ids.push('details')
    if (canLeaveSelect && canLeaveDetails) ids.push('review')
    return ids
  }, [canLeaveSelect, canLeaveDetails])

  const goNext = (): void => {
    setError(null)
    if (step === 'select') {
      if (!canLeaveSelect) return
      setStep('details')
      return
    }
    if (step === 'details') {
      setShowErrors(true)
      if (!canLeaveDetails) return
      setStep('review')
    }
  }

  const goBack = (): void => {
    setError(null)
    if (step === 'review') setStep('details')
    else if (step === 'details') setStep('select')
    else onCancel()
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    const saved: CredentialSummary[] = []
    try {
      for (const service of services) {
        const draft = drafts[service.id] ?? { label: '', values: {} }
        saved.push(await save({ serviceId: service.id, label: draft.label, values: draft.values }))
      }
      onSaved(saved)
    } catch (cause) {
      // Report what did land: a partial save is recoverable only if the user can see it.
      setError(
        `${cause instanceof Error ? cause.message : String(cause)}${
          saved.length > 0 ? ` (${saved.length} of ${services.length} saved)` : ''
        }`
      )
      if (saved.length > 0) onSaved(saved)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="credential-wizard flex min-h-0 flex-1 flex-col">
      <div className="border-b px-5 py-3">
        <CredentialStepper steps={STEPS} current={step} reachable={reachable} onSelect={setStep} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {step === 'select' ? (
          <div className="flex flex-col gap-4">
            <StepHeading
              title="Choose a service"
              description={`Select up to ${MAX_SELECTIONS} services to store credentials for. Pick Custom for anything else.`}
            />
            <ServiceSelectGrid
              services={CREDENTIAL_SERVICES}
              selected={selected}
              onSelectedChange={setSelected}
              maxSelections={MAX_SELECTIONS}
            />
          </div>
        ) : null}

        {step === 'details' ? (
          <div className="flex flex-col gap-4">
            <StepHeading
              title="Enter credentials"
              description="Required fields are marked. Secrets are encrypted by your OS keychain when you save."
            />
            <CredentialFieldsStep
              services={services}
              drafts={drafts}
              showErrors={showErrors}
              onOpenDocs={onOpenDocs}
              onDraftChange={(serviceId, draft) => setDrafts((current) => ({ ...current, [serviceId]: draft }))}
            />
          </div>
        ) : null}

        {step === 'review' ? (
          <ReviewStep services={services} drafts={drafts} encryptionAvailable={encryptionAvailable} />
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
        <Button type="button" variant="outline" size="sm" data-ui="credentials.back" onClick={goBack}>
          <ArrowLeft />
          {step === 'select' ? 'Cancel' : 'Go back'}
        </Button>

        <div className="flex min-w-0 items-center gap-3">
          {error ? <p className="truncate text-xs text-destructive">{error}</p> : null}
          {step === 'review' ? (
            <Button type="button" size="sm" data-ui="credentials.save" disabled={saving} onClick={() => void handleSave()}>
              {saving ? <Loader2 className="animate-spin" /> : <Lock />}
              {saving ? 'Saving…' : `Save ${services.length > 1 ? `${services.length} credentials` : 'credential'}`}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              data-ui="credentials.next"
              disabled={step === 'select' && !canLeaveSelect}
              onClick={goNext}
            >
              Next step
              <ArrowRight />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function StepHeading({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

type ReviewStepProps = {
  services: CredentialServiceSpec[]
  drafts: Record<string, CredentialDraftState>
  encryptionAvailable: boolean
}

function ReviewStep({ services, drafts, encryptionAvailable }: ReviewStepProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <StepHeading
        title="Review and save"
        description="Secret values are shown masked. Nothing is written until you save."
      />

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
            ? 'Secrets are encrypted with your OS keychain before they are written to disk.'
            : 'No OS keychain is available on this machine, so secrets are written unencrypted. Save only what you can rotate.'}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {services.map((service) => {
          const draft = drafts[service.id] ?? { label: '', values: {} }
          const Logo = CREDENTIAL_SERVICE_LOGOS[service.id]

          return (
            <div key={service.id} className="rounded-xl border bg-card/60 p-3">
              <div className="flex items-center gap-2 pb-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60 [&_svg]:size-4">
                  <Logo />
                </span>
                <span className="text-sm font-semibold">{draft.label.trim() || service.name}</span>
                <span className="text-xs text-muted-foreground">{service.name}</span>
              </div>
              <dl className="grid gap-1.5">
                {service.fields.map((field) => {
                  const value = draft.values[field.id]?.trim() ?? ''
                  if (!value) return null
                  return (
                    <div key={field.id} className="flex items-baseline justify-between gap-3 text-xs">
                      <dt className="shrink-0 text-muted-foreground">{field.label}</dt>
                      <dd className="truncate font-mono">{field.kind === 'secret' ? maskSecret(value) : value}</dd>
                    </div>
                  )
                })}
              </dl>
            </div>
          )
        })}
      </div>
    </div>
  )
}
