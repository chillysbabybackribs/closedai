import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'

import { GenerationLoader } from '../components/ui/generation-loader.js'
import type { ChatTranscriptItem } from '../shared/chat.js'
import { isActivity } from './transcript-rows.js'

export function TaskActivity({
  items,
  activeTurnId
}: {
  items: ChatTranscriptItem[]
  activeTurnId: string | null
}): JSX.Element | null {
  const label = useMemo(() => taskActivityLabel(items, activeTurnId), [items, activeTurnId])
  const tick = useLoaderTick(Boolean(label))

  if (!label) return null
  return (
    <div className="task-activity-strip">
      <GenerationLoader label={label} tick={tick} variant="rounded" />
    </div>
  )
}

export function taskActivityLabel(items: ChatTranscriptItem[], activeTurnId: string | null): string {
  if (!activeTurnId) return ''

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!
    if (item.turnId !== activeTurnId) continue
    if (item.type === 'reasoning' || item.type === 'plan' || item.type === 'user') return 'Thinking'
    if (item.type === 'assistant') return item.streaming && item.text ? 'Responding' : 'Thinking'
    if (isActivity(item)) {
      const status = item.status.toLowerCase()
      if (status.includes('pending') || status.includes('request')) return 'Needs your approval'
      // Deliberately not the activity's own title: that exact string is already the headline of the
      // row directly above this strip, and repeating it made the two read as one stuttering line.
      // The row names what is happening; the strip only says that something still is.
      if (status.includes('progress') || status.includes('running')) return 'Working'
      return 'Thinking'
    }
    if (item.type === 'screenshot') return 'Looking'
    return 'Working'
  }

  return 'Thinking'
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
