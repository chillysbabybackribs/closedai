import type { CSSProperties, JSX, ReactNode } from 'react'
import { useEffect, useState } from 'react'

/** Ambient strip under the transcript. It now carries only the background-task control: the
 *  working timer moved onto the composer's project rail, where the turn is actually driven. */
export function TaskActivity({ children }: { children?: ReactNode }): JSX.Element | null {
  if (!children) return null
  return <div className="task-activity-strip">{children}</div>
}

/** Widest timer the rail reserves room for: a four-digit "88m 88s" clock. Anything shorter is
 *  padded to the same box, so the copy holds one position while time runs. */
const RESERVED_TIMER_LABEL = 'Working for 88m 88s'

/** The "Working for 12s" timer, rendered on the left edge of the composer project rail. The only
 *  motion is the highlight sweeping through its own glyphs — the same shimmer the transcript's
 *  running headline uses — so the rail stays quiet while a turn runs. */
export function TurnActivityIndicator({ activeTurnId }: { activeTurnId: string | null }): JSX.Element | null {
  const elapsedSeconds = useTurnElapsed(activeTurnId)

  if (!activeTurnId) return null
  const label = `Working for ${formatElapsedTime(elapsedSeconds)}`
  return (
    <div
      className="composer-strip-activity task-timer"
      role="status"
      aria-live="off"
      aria-atomic="true"
      aria-label={label}
      style={{ '--shimmer-spread': `${RESERVED_TIMER_LABEL.length * 2}px` } as CSSProperties}
    >
      <span className="task-timer-reserve" aria-hidden="true">{RESERVED_TIMER_LABEL}</span>
      <span className="task-timer-text">{label}</span>
    </div>
  )
}

export function formatElapsedTime(totalSeconds: number): string {
  const elapsed = Math.max(0, Math.floor(totalSeconds))
  if (elapsed < 60) return `${elapsed}s`
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m ${seconds}s`
}

function useTurnElapsed(activeTurnId: string | null): number {
  const [clock, setClock] = useState<{ turnId: string | null; seconds: number }>({
    turnId: null,
    seconds: 0
  })

  useEffect(() => {
    if (!activeTurnId) {
      setClock({ turnId: null, seconds: 0 })
      return
    }

    const startedAt = Date.now()
    setClock({ turnId: activeTurnId, seconds: 0 })
    const id = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1_000)
      setClock((current) => current.turnId === activeTurnId && current.seconds === seconds
        ? current
        : { turnId: activeTurnId, seconds })
    }, 250)
    return () => window.clearInterval(id)
  }, [activeTurnId])

  return clock.turnId === activeTurnId ? clock.seconds : 0
}
