import type { JSX, ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

type Shown = { key: string; node: ReactNode }

/**
 * One fixed place in a live turn's stage. When its key changes, the outgoing content keeps its
 * element (same key, so React moves it rather than remounting it) and slides out on top while
 * the new content slides in, so a swap never shows an empty frame or rebuilds what is leaving.
 * The same key with new content (streaming text, a ticking step) just updates in place.
 */
export function RollSlot({ slotKey, children, className, ...data }: {
  slotKey: string | null
  children: ReactNode
  className?: string
  [attribute: `data-${string}`]: string | boolean | undefined
}): JSX.Element {
  const latest = useRef<Shown | null>(null)
  const [shownKey, setShownKey] = useState(slotKey)
  const [leaving, setLeaving] = useState<Shown | null>(null)
  if (shownKey !== slotKey) {
    setShownKey(slotKey)
    setLeaving(latest.current && latest.current.key !== slotKey ? latest.current : null)
  }
  useLayoutEffect(() => {
    latest.current = slotKey === null ? null : { key: slotKey, node: children }
  })
  return (
    <div className={className ? `turn-stage-slot ${className}` : 'turn-stage-slot'} {...data}>
      {/* One keyed list, so the outgoing item is the same element it was a moment ago. */}
      {[
        leaving ? (
          <div key={leaving.key} className="turn-stage-item" data-leaving aria-hidden="true"
            onAnimationEnd={(event) => { if (event.target === event.currentTarget) setLeaving(null) }}>
            {leaving.node}
          </div>
        ) : null,
        slotKey !== null ? <div key={slotKey} className="turn-stage-item">{children}</div> : null
      ]}
    </div>
  )
}
