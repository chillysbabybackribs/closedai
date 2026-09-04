import { useState, type JSX } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '../../components/ui/input.js'
import type { CredentialFieldSpec, CredentialServiceId } from '../../shared/credentials.js'

export type CredentialFieldRowProps = {
  serviceId: CredentialServiceId
  field: CredentialFieldSpec
  value: string
  error?: string
  autoFocus?: boolean
  onChange: (value: string) => void
}

/** One input from the service catalog. Secrets are masked with a per-field reveal. */
export function CredentialFieldRow({
  serviceId,
  field,
  value,
  error,
  autoFocus,
  onChange
}: CredentialFieldRowProps): JSX.Element {
  const [visible, setVisible] = useState(false)
  const inputId = `credential-${field.id}`
  const key = `${serviceId}.${field.id}`
  const secret = field.kind === 'secret'

  return (
    <div role="group" data-slot="field" className="flex w-full flex-col gap-2">
      <label htmlFor={inputId} className="flex w-fit items-center gap-1 text-sm font-medium">
        {field.label}
        {field.required ? <span className="text-destructive">*</span> : null}
      </label>

      <div className="relative">
        <Input
          id={inputId}
          data-ui="credentials.field"
          data-ui-key={key}
          type={secret && !visible ? 'password' : field.kind === 'url' ? 'url' : 'text'}
          value={value}
          placeholder={field.placeholder ?? ''}
          aria-invalid={Boolean(error)}
          autoComplete={field.kind === 'username' ? 'username' : 'off'}
          autoFocus={autoFocus}
          spellCheck={false}
          className={secret ? 'pr-9 font-mono' : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {secret ? (
          <button
            type="button"
            data-ui="credentials.peek"
            data-ui-key={key}
            className="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`${visible ? 'Hide' : 'Show'} ${field.label.toLowerCase()}`}
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : field.help ? (
        <p className="text-xs text-muted-foreground">{field.help}</p>
      ) : null}
    </div>
  )
}
