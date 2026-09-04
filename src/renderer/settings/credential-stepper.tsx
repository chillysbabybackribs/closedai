import type { JSX } from 'react'
import { Check } from 'lucide-react'
import { cn } from '../../lib/utils.js'

/**
 * Horizontal stepper, rebuilt from the rendered ReUI `wizard-1` block
 * (https://reui.io/blocks/application/wizard): a size-6 round indicator per step,
 * primary/10 while active, solid primary once completed, muted while inactive, with a
 * 2px separator between items that turns primary behind completed steps.
 */

export type StepperStep<Id extends string> = { id: Id; title: string }

export type CredentialStepperProps<Id extends string> = {
  steps: readonly StepperStep<Id>[]
  current: Id
  /** Steps the user may jump back to; forward jumps stay disabled until validated. */
  reachable?: readonly Id[]
  onSelect?: (id: Id) => void
}

export function CredentialStepper<Id extends string>({
  steps,
  current,
  reachable = [],
  onSelect
}: CredentialStepperProps<Id>): JSX.Element {
  const currentIndex = steps.findIndex((step) => step.id === current)

  return (
    <nav
      data-slot="stepper-nav"
      data-orientation="horizontal"
      aria-label="Credential setup steps"
      className="group/stepper-nav inline-flex w-full flex-row items-center"
    >
      {steps.map((step, index) => {
        const state = index === currentIndex ? 'active' : index < currentIndex ? 'completed' : 'inactive'
        const selectable = state !== 'active' && reachable.includes(step.id)

        return (
          <div
            key={step.id}
            data-slot="stepper-item"
            data-state={state}
            className="group/step relative flex items-center justify-center not-last:flex-1"
          >
            <button
              type="button"
              data-slot="stepper-trigger"
              data-state={state}
              data-ui="credentials.step"
              data-ui-key={step.id}
              disabled={!selectable}
              aria-current={state === 'active' ? 'step' : undefined}
              onClick={selectable ? () => onSelect?.(step.id) : undefined}
              className={cn(
                'flex items-center justify-start gap-1.5 rounded-full outline-none',
                'focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50',
                selectable ? 'cursor-pointer' : 'cursor-default disabled:opacity-60'
              )}
            >
              <span
                data-slot="stepper-indicator"
                data-state={state}
                className={cn(
                  'relative isolate flex size-6 shrink-0 items-center justify-center overflow-visible rounded-full text-xs',
                  state === 'active' && 'bg-primary/10 text-primary',
                  state === 'completed' && 'bg-primary text-primary-foreground',
                  state === 'inactive' && 'border border-border bg-muted text-foreground'
                )}
              >
                {state === 'completed' ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
              </span>
              <span data-slot="stepper-title" className="text-sm font-medium">
                {step.title}
              </span>
            </button>

            {index < steps.length - 1 ? (
              <span
                data-slot="stepper-separator"
                className={cn('m-0.5 h-0.5 flex-1 md:mx-2.5', state === 'completed' ? 'bg-primary' : 'bg-border')}
              />
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}
