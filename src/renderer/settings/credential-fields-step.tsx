import { useState, type JSX } from 'react'
import { Eye, EyeOff, ExternalLink } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Input } from '../../components/ui/input.js'
import { cn } from '../../lib/utils.js'
import type { CredentialFieldSpec, CredentialServiceId, CredentialServiceSpec } from '../../shared/credentials.js'
import { CREDENTIAL_SERVICE_LOGOS } from './credential-service-logos.js'

/** One service's in-progress entry: the name it is saved under plus its field values. */
export type CredentialDraftState = { label: string; values: Record<string, string> }

export type CredentialFieldsStepProps = {
  services: CredentialServiceSpec[]
  drafts: Record<string, CredentialDraftState>
  onDraftChange: (serviceId: CredentialServiceId, draft: CredentialDraftState) => void
  /** Set once Next has been attempted, so blanks are only flagged after a real attempt. */
  showErrors: boolean
  onOpenDocs?: (url: string) => void
}

export function CredentialFieldsStep({
  services,
  drafts,
  onDraftChange,
  showErrors,
  onOpenDocs
}: CredentialFieldsStepProps): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      {services.map((service) => {
        const draft = drafts[service.id] ?? { label: '', values: {} }
        const Logo = CREDENTIAL_SERVICE_LOGOS[service.id]

        return (
          <section key={service.id} className="flex flex-col gap-3">
            <header className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border-2 border-background bg-muted/60 shadow-[0_1px_3px_0_rgba(0,0,0,0.14)] dark:border">
                <Logo />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{service.name}</h3>
                <p className="truncate text-xs text-muted-foreground">{service.description}</p>
              </div>
              {service.docsUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  data-ui="credentials.docs"
                  data-ui-key={service.id}
                  onClick={() => onOpenDocs?.(service.docsUrl as string)}
                >
                  Get key
                  <ExternalLink />
                </Button>
              ) : null}
            </header>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow
                label="Entry name"
                htmlFor={`credential-label-${service.id}`}
                help="Shown in the vault list."
              >
                <Input
                  id={`credential-label-${service.id}`}
                  data-ui="credentials.label"
                  data-ui-key={service.id}
                  value={draft.label}
                  placeholder={`${service.name} — production`}
                  onChange={(event) => onDraftChange(service.id, { ...draft, label: event.target.value })}
                />
              </FieldRow>

              {service.fields.map((spec) => (
                <CredentialField
                  key={spec.id}
                  service={service}
                  spec={spec}
                  value={draft.values[spec.id] ?? ''}
                  invalid={showErrors && Boolean(spec.required) && !draft.values[spec.id]?.trim()}
                  onChange={(value) =>
                    onDraftChange(service.id, { ...draft, values: { ...draft.values, [spec.id]: value } })
                  }
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

type FieldRowProps = {
  label: string
  htmlFor: string
  help?: string
  required?: boolean
  children: JSX.Element
}

function FieldRow({ label, htmlFor, help, required, children }: FieldRowProps): JSX.Element {
  return (
    <div role="group" data-slot="field" className="flex w-full flex-col gap-2">
      <label htmlFor={htmlFor} className="flex w-fit items-center gap-1 text-sm font-medium">
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </label>
      {children}
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  )
}

type CredentialFieldProps = {
  service: CredentialServiceSpec
  spec: CredentialFieldSpec
  value: string
  invalid: boolean
  onChange: (value: string) => void
}

function CredentialField({ service, spec, value, invalid, onChange }: CredentialFieldProps): JSX.Element {
  const [visible, setVisible] = useState(false)
  const inputId = `credential-${service.id}-${spec.id}`
  const isSecret = spec.kind === 'secret'

  return (
    <FieldRow
      label={spec.label}
      htmlFor={inputId}
      required={spec.required}
      help={invalid ? `${spec.label} is required.` : spec.help}
    >
      <div className="relative">
        <Input
          id={inputId}
          data-ui="credentials.field"
          data-ui-key={`${service.id}.${spec.id}`}
          type={isSecret && !visible ? 'password' : 'text'}
          value={value}
          placeholder={spec.placeholder}
          aria-invalid={invalid}
          autoComplete="off"
          spellCheck={false}
          className={cn(isSecret && 'pr-9 font-mono')}
          onChange={(event) => onChange(event.target.value)}
        />
        {isSecret ? (
          <button
            type="button"
            data-ui="credentials.peek"
            data-ui-key={`${service.id}.${spec.id}`}
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? `Hide ${spec.label}` : `Show ${spec.label}`}
            className="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        ) : null}
      </div>
    </FieldRow>
  )
}
