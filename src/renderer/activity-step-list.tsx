import type { JSX } from 'react'
import { memo, useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, CircleEllipsis, FilePenLine, LoaderCircle, SquareTerminal, Wrench, X, XCircle } from 'lucide-react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible.js'
import {
  activitySteps,
  activitySummary,
  PHASE_LABEL,
  summaryLabel,
  type ActivityStep,
  type StepBody
} from './activity-steps.js'
import type { ActivityItem } from './transcript-rows.js'

/**
 * The opened body of an activity row: a flat list, one line per step, that sits directly
 * under the headline with no frame of its own. Each line carries an icon for what kind of
 * step it was, the verb, the literal command or path, and timing on the right. Opening a
 * step reveals its details beneath the line without adding another box to the reel.
 * Failures announce themselves on a line above the list and open their output by default.
 */
export const ActivitySteps = memo(function ActivitySteps({ items }: { items: ActivityItem[] }): JSX.Element {
  const live = items.some((item) => item.status.toLowerCase().includes('progress') || item.status.toLowerCase().includes('running'))
  const now = useClock(live)
  const steps = useMemo(() => activitySteps(items, now), [items, now])
  const summary = useMemo(() => activitySummary(items, now), [items, now])
  const failures = steps.flatMap((step) => (step.failure ? [step.failure] : []))
  const showSummary = summary.total > 1 || summary.elapsedMs !== null
  return (
    <div className="activity-steps" data-running={live || undefined}>
      {failures.length || showSummary ? (
        <div className="activity-steps-header">
          {failures.length ? (
            <p className="activity-steps-alert" role="alert">
              <XCircle aria-hidden="true" />
              <span>{failures.length === 1 ? failures[0] : `${failures.length} steps failed`}</span>
            </p>
          ) : null}
          {showSummary ? <span className="activity-steps-summary">{summaryLabel(summary)}</span> : null}
        </div>
      ) : null}
      <ol className="activity-steps-list">
        {steps.map((step) => <StepRow key={step.id} step={step} />)}
      </ol>
    </div>
  )
})

/** Durations tick once a second only while something is still running. */
function useClock(live: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [live])
  return now
}

const StepRow = memo(function StepRow({ step }: { step: ActivityStep }): JSX.Element {
  const expandable = step.body !== null
  const [open, setOpen] = useState(step.phase === 'failed')
  const text = step.label ? `${step.verb} ${step.label}` : step.verb
  return (
    <li className="activity-step" data-phase={step.phase} data-expandable={expandable || undefined}>
      <Collapsible open={open && expandable} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild disabled={!expandable}>
          <button type="button" className="activity-step-row" aria-label={`${text}, ${PHASE_LABEL[step.phase]}`}>
            <StepIcon step={step} />
            <span className="activity-step-text" title={step.title ?? undefined}>
              <span className="activity-step-verb">{step.verb}</span>
              {step.label ? <span className="activity-step-label"> {step.label}</span> : null}
            </span>
            {step.meta.length ? <span className="activity-step-meta">{step.meta.join(' · ')}</span> : null}
            {expandable ? (
              <ChevronRight className={`activity-step-chevron${open ? ' is-open' : ''}`} aria-hidden="true" />
            ) : null}
          </button>
        </CollapsibleTrigger>
        {step.body ? (
          <CollapsibleContent className="activity-step-body">
            <StepBodyView body={step.body} />
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </li>
  )
})

/** Running steps use a monochrome progress ring; settled steps show their kind. */
function StepIcon({ step }: { step: ActivityStep }): JSX.Element {
  const className = 'activity-step-icon'
  if (step.phase === 'running') {
    return (
      <svg className={`${className} activity-step-spinner`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" opacity="0.2" />
        <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" stroke="currentColor" strokeLinecap="round" />
      </svg>
    )
  }
  if (step.phase === 'pending') return <CircleEllipsis className={className} aria-hidden="true" />
  if (step.kind === 'command') return <SquareTerminal className={className} aria-hidden="true" />
  if (step.kind === 'fileChange') return <FilePenLine className={className} aria-hidden="true" />
  return <Wrench className={className} aria-hidden="true" />
}

/**
 * The details under a step, in the shape of a terminal transcript: a heading naming the
 * surface, the invocation behind a prompt, the output, and the outcome in the corner. The
 * invocation clamps to a few lines and opens on click.
 */
function StepBodyView({ body }: { body: StepBody }): JSX.Element {
  const [fullInvocation, setFullInvocation] = useState(false)
  return (
    <div className="activity-card" data-tone={body.status.tone}>
      <div className="activity-card-heading">{body.heading}</div>
      {body.invocation ? (
        <button
          type="button"
          className="activity-card-invocation"
          data-full={fullInvocation || undefined}
          onClick={() => setFullInvocation((value) => !value)}
          title={fullInvocation ? 'Collapse' : 'Show the whole command'}
        >
          {body.shell ? <span className="activity-card-prompt">$ </span> : null}
          {body.invocation}
        </button>
      ) : null}
      {body.output ? <pre className="activity-card-output">{body.output}</pre> : null}
      {body.diffs.map((entry) => (
        <div key={entry.path} className="activity-card-diff">
          <div className="activity-card-diff-path">{entry.path}</div>
          <pre>
            {entry.diff.split('\n').map((line, index) => (
              <span key={index} data-line={diffLineKind(line)}>{line}{'\n'}</span>
            ))}
          </pre>
        </div>
      ))}
      <div className="activity-card-footer">
        <StatusMark tone={body.status.tone} />
        <span>{body.status.label}</span>
      </div>
    </div>
  )
}

function StatusMark({ tone }: { tone: StepBody['status']['tone'] }): JSX.Element {
  if (tone === 'live') return <LoaderCircle className="activity-card-mark animate-spin" aria-hidden="true" />
  if (tone === 'error') return <X className="activity-card-mark" aria-hidden="true" />
  return <Check className="activity-card-mark" aria-hidden="true" />
}

function diffLineKind(line: string): 'meta' | 'hunk' | 'add' | 'remove' | undefined {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'remove'
  return undefined
}
