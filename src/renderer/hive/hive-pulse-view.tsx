import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button.js'
import '../styles/hive/pulse.css'

const MOMENTS = [
  { afterMs: 0, label: 'Understanding the outcome', ready: false },
  { afterMs: 1800, label: 'Shaping the run', ready: false },
  { afterMs: 3600, label: 'Finding the right capacity', ready: false },
  { afterMs: 5400, label: 'Ready to begin', ready: true }
] as const

type HivePulseViewProps = {
  runTitle: string
  onCancel: () => void
  onReady: () => void
}

export function HivePulseView({ runTitle, onCancel, onReady }: HivePulseViewProps): JSX.Element {
  const [moment, setMoment] = useState(0)

  useEffect(() => {
    const timers = MOMENTS.slice(1).map((item, index) =>
      window.setTimeout(() => setMoment(index + 1), item.afterMs))
    return () => timers.forEach(window.clearTimeout)
  }, [])

  const current = MOMENTS[moment]!
  return (
    <main className="hive-pulse" data-preview-surface="hive-pulse">
      <button
        type="button"
        className="hive-pulse__cancel"
        data-ui="hive.pulse-cancel"
        onClick={onCancel}
      >
        Cancel
      </button>
      <div className="hive-pulse__center">
        <div className="hive-pulse__orb" data-ready={current.ready === true} aria-hidden>
          <span className="hive-pulse__orbit hive-pulse__orbit--outer" />
          <span className="hive-pulse__orbit hive-pulse__orbit--inner" />
          <span className="hive-pulse__core" />
        </div>
        <div className="hive-pulse__copy" aria-live="polite">
          <p className="hive-pulse__status">{current.label}</p>
          <p className="hive-pulse__title">{runTitle}</p>
        </div>
        {current.ready && (
          <Button type="button" size="sm" data-ui="hive.pulse-open" onClick={onReady}>
            Open run
          </Button>
        )}
      </div>
    </main>
  )
}
