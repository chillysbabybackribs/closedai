import { useEffect, useState } from 'react'
import type { TabActivity } from './tab-activity.js'

/** Mounted only while the tooltip is open; ticking never repaints the workspace. */
export function TabActivityPreview({ title, activity }: { title: string; activity?: TabActivity }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!activity?.startedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activity?.startedAt])
  const seconds = activity?.startedAt ? Math.max(0, Math.floor((now - activity.startedAt) / 1000)) : null
  const elapsed = seconds === null ? '' : seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return <>
    <strong>{title}</strong>
    {activity && <>
      <div className="chat-tab-preview-status" data-status={activity.state}>
        {activity.label}{elapsed && <span>{elapsed} since request</span>}
      </div>
      <p>{activity.detail}</p>
      {activity.steps.length > 0 && <ol aria-label="Recent activity">
        {activity.steps.map((step) => <li key={step.id} data-phase={step.phase}>
          <span aria-hidden="true">{step.phase === 'done' ? '✓' : step.phase === 'failed' ? '!' : '·'}</span>
          <span>{step.label}</span><small>{step.phase === 'pending' ? 'pending' : step.phase}</small>
        </li>)}
      </ol>}
    </>}
    <footer>Click to open · Drag to move</footer>
  </>
}
