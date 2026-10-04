import type { JSX } from 'react'
import { memo, useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, CircleEllipsis, FilePenLine, LoaderCircle, SquareTerminal, Wrench, X, XCircle } from './icons/index.js'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible.js'
import {
  activitySteps,
  activitySummary,
  PHASE_LABEL,
  shellOutputRevealLabel,
  summaryLabel,
  type ActivityStep,
  type StepBody
} from './activity-steps.js'
import type { ActivityItem } from './transcript-rows.js'
import { DiffViewer } from './diff-viewer.js'

/**
 * The opened body of an activity row: a flat list, one line per step, that sits directly
 * under the headline with no frame of its own. Each line carries an icon for what kind of
 * step it was, the verb, the literal command or path, and timing on the right. Opening a
 * step reveals its details beneath the line without adding another box to the reel.
 * Failures announce themselves on a line above the list and open their output by default.
 */
export const ActivitySteps = memo(function ActivitySteps({ items, cwd }: { items: ActivityItem[]; cwd?: string }): JSX.Element {
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
        {steps.map((step) => <StepRow key={step.id} step={step} cwd={cwd} />)}
      </ol>
    </div>
  )
})

/** Durations tick once a second only while something is still running. */
export function useClock(live: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [live])
  return now
}

const StepRow = memo(function StepRow({ step, cwd }: { step: ActivityStep; cwd?: string }): JSX.Element {
  const expandable = step.body !== null
  const [open, setOpen] = useState(step.phase === 'failed')
  // Opening a group mounts every step at once; a body Radix has to measure on mount is a forced
  // layout each, so a closed step keeps its body unmounted the way a closed group does.
  const [opened, setOpened] = useState(step.phase === 'failed')
  const text = step.label ? `${step.verb} ${step.label}` : step.verb
  return (
    <li className="activity-step" data-kind={step.kind} data-phase={step.phase} data-expandable={expandable || undefined}>
      <Collapsible open={open && expandable} onOpenChange={(next) => { if (next) setOpened(true); setOpen(next) }}>
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
        {step.body && opened ? (
          <CollapsibleContent className="activity-step-body">
            <StepBodyView body={step.body} stepId={step.id} cwd={cwd} />
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </li>
  )
})

/** Status takes precedence while running or failed; settled steps show their kind. */
function StepIcon({ step }: { step: ActivityStep }): JSX.Element {
  const className = 'activity-step-icon'
  if (step.phase === 'running') {
    return <LoaderCircle className={`${className} activity-step-spinner`} aria-hidden="true" />
  }
  if (step.phase === 'failed') return <XCircle className={className} aria-hidden="true" />
  if (step.phase === 'pending') return <CircleEllipsis className={className} aria-hidden="true" />
  return <KindIcon kind={step.kind} className={className} />
}

export function KindIcon({ kind, className }: { kind: ActivityItem['type']; className: string }): JSX.Element {
  if (kind === 'command') return <SquareTerminal className={className} aria-hidden="true" />
  if (kind === 'fileChange') return <FilePenLine className={className} aria-hidden="true" />
  return <Wrench className={className} aria-hidden="true" />
}

/**
 * A running group is one line: the newest step, its verb shimmering while it runs, and its
 * timer. Keyed by step id at the call site, so each new step rolls in from below at the same
 * height and the transcript under it never moves.
 */
export function LiveLine({ step }: { step: ActivityStep }): JSX.Element {
  return (
    <span className="activity-live-line" data-kind={step.kind} data-phase={step.phase}>
      {step.phase === 'failed'
        ? <XCircle className="activity-step-icon" aria-hidden="true" />
        : <KindIcon kind={step.kind} className="activity-step-icon" />}
      <span className="activity-step-text" title={step.title ?? undefined}>
        <span className={step.phase === 'running' || step.phase === 'pending' ? 'activity-live-verb' : 'activity-step-verb'}>{step.verb}</span>
        {step.label ? <span className="activity-step-label"> {step.label}</span> : null}
      </span>
      {step.meta.length ? <span className="activity-step-meta">{step.meta.join(' · ')}</span> : null}
    </span>
  )
}

/**
 * The details under a step, in the shape of a terminal transcript: a heading naming the
 * surface, the invocation behind a prompt, the output, and the outcome in the corner. The
 * invocation clamps to a few lines and opens on click.
 */
function StepBodyView({ body, stepId, cwd }: { body: StepBody; stepId: string; cwd?: string }): JSX.Element {
  const [fullInvocation, setFullInvocation] = useState(false)
  const [showOutput, setShowOutput] = useState(Boolean(body.output))
  const revealed = body.output ?? (showOutput ? body.withheldOutput : null)
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
      {body.withheldOutput && !showOutput ? (
        <button
          type="button"
          className="activity-card-output-toggle"
          data-ui="chat.activity-step-output"
          data-ui-key={stepId}
          onClick={() => setShowOutput(true)}
        >
          {shellOutputRevealLabel(body.withheldOutput)}
        </button>
      ) : null}
      {revealed ? <pre className="activity-card-output">{revealed}</pre> : null}
      {body.diffs.map((entry) => (
        <DiffViewer key={entry.path} path={entry.path} diff={entry.diff} cwd={cwd} />
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
