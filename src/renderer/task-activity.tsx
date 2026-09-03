import type { JSX, ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { GenerationLoader } from '../components/ui/generation-loader.js'

/** Ambient strip under the transcript. It now carries only the background-task control: the
 *  working timer moved onto the composer's project rail, where the turn is actually driven. */
export function TaskActivity({ children }: { children?: ReactNode }): JSX.Element | null {
  if (!children) return null
  return <div className="task-activity-strip">{children}</div>
}

/** Widest timer the rail reserves room for: a four-digit "88m 88s" clock. Anything shorter is
 *  padded to the same box, so the pixel grid and the copy hold one position while time runs. */
const RESERVED_TIMER_LABEL = 'Working for 88m 88s'

/** The "Working for 12s" timer, rendered on the left edge of the composer project rail. */
export function TurnActivityIndicator({ activeTurnId }: { activeTurnId: string | null }): JSX.Element | null {
  const elapsedSeconds = useTurnElapsed(activeTurnId)
  const tick = useLoaderTick(activeTurnId !== null)

  if (!activeTurnId) return null
  const label = `Working for ${formatElapsedTime(elapsedSeconds)}`
  return (
    <GenerationLoader
      className="composer-strip-activity"
      label={label}
      reserveLabel={RESERVED_TIMER_LABEL}
      tick={tick}
      animateLabel={false}
      variant="rounded"
      aria-label={label}
      aria-live="off"
    />
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

function useLoaderTick(active: boolean): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setTick((current) => current + 1), 120)
    return () => window.clearInterval(id)
  }, [active])

  return tick
}
