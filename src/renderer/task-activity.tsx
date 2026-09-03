import type { JSX } from 'react'
import { useEffect, useState } from 'react'

import { GenerationLoader } from '../components/ui/generation-loader.js'

export function TaskActivity({
  activeTurnId
}: {
  activeTurnId: string | null
}): JSX.Element | null {
  const elapsedSeconds = useTurnElapsed(activeTurnId)
  const tick = useLoaderTick(activeTurnId !== null)

  if (!activeTurnId) return null
  return (
    <div className="task-activity-strip">
      <GenerationLoader
        label={formatElapsedTime(elapsedSeconds)}
        tick={tick}
        animateLabel={false}
        variant="rounded"
      />
    </div>
  )
}

export function formatElapsedTime(totalSeconds: number): string {
  const elapsed = Math.max(0, Math.floor(totalSeconds))
  const seconds = elapsed % 60
  const totalMinutes = Math.floor(elapsed / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
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
