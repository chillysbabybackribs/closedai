import type { JSX } from 'react'

import { cn } from '../../lib/utils.js'

/** Remaining allowance (0–100) for provider quota chips; not context-window utilization. */
export type UsageMeterLevel = 'normal' | 'low' | 'critical' | 'exhausted' | 'stale' | 'unknown'

const RADIUS = 5.25
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const VIEW = 14

/** Compact ring with the remaining percent centered; matches composer context-meter stroke geometry. */
export function UsageMeterRing({
  remaining,
  level,
  size = 22,
  className
}: {
  remaining: number | null
  level: UsageMeterLevel
  size?: number
  className?: string
}): JSX.Element {
  const indeterminate = remaining === null || !Number.isFinite(remaining)
  const clamped = indeterminate ? 0 : Math.min(100, Math.max(0, Math.round(remaining)))
  const dash = (CIRCUMFERENCE * clamped) / 100
  const digits = indeterminate ? 0 : clamped >= 100 ? 3 : clamped >= 10 ? 2 : 1
  return (
    <span
      className={cn('usage-meter-ring', className)}
      data-level={level}
      data-digits={digits}
      data-indeterminate={indeterminate ? 'true' : undefined}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg className="usage-meter-ring-svg" viewBox={`0 0 ${VIEW} ${VIEW}`} width={size} height={size}>
        <circle className="usage-meter-ring-track" cx={VIEW / 2} cy={VIEW / 2} r={RADIUS} />
        {!indeterminate && (
          <circle
            className="usage-meter-ring-fill"
            cx={VIEW / 2}
            cy={VIEW / 2}
            r={RADIUS}
            strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
          />
        )}
      </svg>
      <span className="usage-meter-ring-value">{indeterminate ? '—' : clamped}</span>
    </span>
  )
}
