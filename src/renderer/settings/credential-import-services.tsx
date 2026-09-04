import { useId, useState, type JSX } from 'react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { Checkbox } from 'radix-ui'
import { Button } from '../../components/ui/button.js'
import { cn } from '../../lib/utils.js'
import { CREDENTIAL_SERVICE_LOGOS, type CredentialServiceId } from './credential-service-logos.js'

/**
 * "Import from other services" step, reproduced from the ReUI `settings-1`
 * block (https://reui.io/blocks/application/settings). The block's source is
 * behind a Pro license, so this is rebuilt from its rendered markup and
 * computed styles: a Card with a 3-column grid of selectable Frame cards, a
 * corner checkbox, a brand tile, a title row with an import-difficulty badge,
 * a description, and a footer with Go back / Next step. Selection is capped
 * and a click past the cap is silently ignored, exactly as the block behaves.
 */

export type ImportDifficulty = 'easy' | 'two-step'

export type ImportService = {
  id: CredentialServiceId
  name: string
  description: string
  difficulty: ImportDifficulty
}

export const DEFAULT_IMPORT_SERVICES: ImportService[] = [
  { id: 'stripe', name: 'Stripe', description: 'Payment processing platform for online transactions.', difficulty: 'easy' },
  { id: 'supabase', name: 'Supabase', description: 'Open-source Firebase alternative with database and authentication.', difficulty: 'easy' },
  { id: 'openai', name: 'OpenAI', description: 'AI models and APIs for building intelligent applications.', difficulty: 'easy' },
  { id: 'discord', name: 'Discord', description: 'Communication platform for communities with chat and voice.', difficulty: 'easy' },
  { id: 'anthropic', name: 'Anthropic', description: 'AI safety company building reliable and interpretable AI systems.', difficulty: 'two-step' },
  { id: 'resend', name: 'Resend', description: 'Modern email API built for developers with great deliverability.', difficulty: 'easy' },
  { id: 'neon', name: 'Neon', description: 'Serverless Postgres database with branching and auto-scaling.', difficulty: 'two-step' },
  { id: 'planetscale', name: 'PlanetScale', description: 'MySQL-compatible serverless database with branching workflows.', difficulty: 'two-step' },
  { id: 'redis', name: 'Redis', description: 'In-memory data store for caching, messaging, and real-time apps.', difficulty: 'easy' }
]

const DIFFICULTY_BADGE: Record<ImportDifficulty, { label: string; className: string }> = {
  easy: {
    label: 'Easy Import',
    className: 'border-blue-500/15 bg-blue-500/10 text-blue-600 dark:border-blue-400/25 dark:bg-blue-400/15 dark:text-blue-400'
  },
  'two-step': {
    label: '2-Step Import',
    className: 'border-amber-500/15 bg-amber-500/10 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/15 dark:text-amber-400'
  }
}

export type ImportServicesStepProps = {
  services?: ImportService[]
  /** Maximum number of services that can be selected at once. Block default is 2. */
  maxSelections?: number
  selected?: CredentialServiceId[]
  onSelectedChange?: (selected: CredentialServiceId[]) => void
  onBack?: () => void
  onNext?: (selected: CredentialServiceId[]) => void
  title?: string
  description?: string
  backLabel?: string
  nextLabel?: string
  className?: string
}

export function ImportServicesStep({
  services = DEFAULT_IMPORT_SERVICES,
  maxSelections = 2,
  selected,
  onSelectedChange,
  onBack,
  onNext,
  title = 'Import from other services',
  description = 'Select maximum 2 services to copy tasks from and authentication details to access their API.',
  backLabel = 'Go back',
  nextLabel = 'Next step',
  className
}: ImportServicesStepProps): JSX.Element {
  const [internal, setInternal] = useState<CredentialServiceId[]>([])
  const value = selected ?? internal
  const idPrefix = useId()

  const setSelected = (next: CredentialServiceId[]): void => {
    if (selected === undefined) setInternal(next)
    onSelectedChange?.(next)
  }

  const toggle = (id: CredentialServiceId, checked: boolean): void => {
    if (checked) {
      if (value.includes(id) || value.length >= maxSelections) return
      setSelected([...value, id])
      return
    }
    setSelected(value.filter((entry) => entry !== id))
  }

  return (
    <div
      data-slot="card"
      className={cn(
        'group/card flex w-full max-w-4xl flex-col gap-4 rounded-xl bg-card pt-4 text-card-foreground ring-1 ring-foreground/10',
        className
      )}
    >
      <div data-slot="card-header" className="grid auto-rows-min items-start gap-1 px-4">
        <div data-slot="card-title" className="text-base font-medium leading-[22px]">
          {title}
        </div>
        <div data-slot="card-description" className="text-sm text-muted-foreground">
          {description}
        </div>
      </div>

      <div data-slot="card-content" className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 md:grid-cols-3">
        {services.map((service) => (
          <ServiceCard
            key={service.id}
            service={service}
            inputId={`${idPrefix}-import-service-${service.id}`}
            checked={value.includes(service.id)}
            onCheckedChange={(checked) => toggle(service.id, checked)}
          />
        ))}
      </div>

      <div data-slot="card-footer" className="flex items-center justify-between border-t p-4">
        <Button type="button" variant="outline" size="sm" className="rounded-[10px]" onClick={onBack}>
          <ArrowLeft />
          {backLabel}
        </Button>
        <Button type="button" size="sm" className="rounded-[10px]" onClick={() => onNext?.(value)}>
          {nextLabel}
          <ArrowRight />
        </Button>
      </div>
    </div>
  )
}

type ServiceCardProps = {
  service: ImportService
  inputId: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

function ServiceCard({ service, inputId, checked, onCheckedChange }: ServiceCardProps): JSX.Element {
  const Logo = CREDENTIAL_SERVICE_LOGOS[service.id]
  const badge = DIFFICULTY_BADGE[service.difficulty]

  return (
    <div
      data-slot="frame"
      data-state={checked ? 'checked' : 'unchecked'}
      className={cn(
        'relative flex flex-col gap-[3px] rounded-xl border bg-muted/50 bg-clip-padding p-[3px] transition-colors',
        checked && 'ring-2 ring-primary'
      )}
    >
      <div
        data-slot="frame-panel"
        className="relative flex grow flex-col overflow-hidden rounded-[10px] border bg-card bg-clip-padding p-0"
      >
        <label
          data-slot="field-label"
          htmlFor={inputId}
          className="relative block w-full cursor-pointer select-none border-0 p-0"
        >
          <div
            role="group"
            data-slot="field"
            data-orientation="horizontal"
            className="flex w-full flex-row items-center gap-2 p-2.5"
          >
            <Checkbox.Root
              id={inputId}
              data-slot="checkbox"
              checked={checked}
              onCheckedChange={(next) => onCheckedChange(next === true)}
              aria-label={`Select ${service.name}`}
              className={cn(
                'peer absolute top-2.5 right-2.5 z-10 flex size-5 shrink-0 items-center justify-center rounded-full border outline-none',
                'border-foreground/15 bg-foreground/[0.045] shadow-xs transition-colors',
                'after:absolute after:-inset-x-3 after:-inset-y-2',
                'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              <Checkbox.Indicator
                data-slot="checkbox-indicator"
                className="grid place-content-center text-current transition-none"
              >
                <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
              </Checkbox.Indicator>
            </Checkbox.Root>

            <div className="flex w-full flex-col gap-3">
              <div
                data-slot="item"
                className="flex size-11 shrink-0 items-center justify-center rounded-[10px] border-2 border-background bg-muted/60 p-0 shadow-[0_1px_3px_0_rgba(0,0,0,0.14)] dark:border"
              >
                <div
                  data-slot="item-media"
                  data-variant="icon"
                  className="flex size-auto shrink-0 items-center justify-center [&_svg]:pointer-events-none"
                >
                  <Logo />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{service.name}</h2>
                <span
                  data-slot="badge"
                  className={cn(
                    'relative inline-flex h-5 w-fit min-w-5 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border px-1.25 py-0.5 text-xs font-medium outline-none',
                    badge.className
                  )}
                >
                  {badge.label}
                </span>
              </div>

              <p className="text-sm text-muted-foreground">{service.description}</p>
            </div>
          </div>
        </label>
      </div>
    </div>
  )
}
