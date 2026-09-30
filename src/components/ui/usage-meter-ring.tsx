import type { JSX } from 'react'

import { cn } from '../../lib/utils.js'

/** Remaining allowance (0–100) for provider quota chips; not context-window utilization. */
export type UsageMeterLevel = 'normal' | 'low' | 'critical' | 'exhausted' | 'stale' | 'unknown'

const RADIUS = 10
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Compact ring with the remaining percent centered; track shows the full window. */
export function UsageMeterRing({
  remaining,
  level,
  size = 28,
  className
}: {
  remaining: number
  level: UsageMeterLevel
  size?: number
  className?: string
}): JSX.Element {
  const clamped = Math.min(100, Math.max(0, Math.round(remaining)))
  const dash = (CIRCUMFERENCE * clamped) / 100
  const digits = clamped >= 100 ? 3 : clamped >= 10 ? 2 : 1
  return (
    <span
      className={cn('usage-meter-ring', className)}
      data-level={level}
      data-digits={digits}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg className="usage-meter-ring-svg" viewBox="0 0 28 28" width={size} height={size}>
        <circle className="usage-meter-ring-track" cx="14" cy="14" r={RADIUS} />
        <circle
          className="usage-meter-ring-fill"
          cx="14"
          cy="14"
          r={RADIUS}
          strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
        />
      </svg>
      <span className="usage-meter-ring-value">{clamped}</span>
    </span>
  )
}
