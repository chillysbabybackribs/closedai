import type { JSX } from 'react'
import { CircleAlert, CircleCheck, CirclePause, Clock3, PlayCircle } from 'lucide-react'
import { RUN_STATUS_LABELS, type RunStatus } from './operations-data.js'

export function RunStatusBadge({ status }: { status: RunStatus }): JSX.Element {
  const Icon = status === 'completed'
    ? CircleCheck
    : status === 'running'
      ? PlayCircle
      : status === 'attention' || status === 'failed'
        ? CircleAlert
        : status === 'paused'
          ? CirclePause
          : Clock3
  return (
    <span className="ops-status" data-status={status}>
      <Icon size={10} fill="currentColor" aria-hidden="true" />
      {RUN_STATUS_LABELS[status]}
    </span>
  )
}
