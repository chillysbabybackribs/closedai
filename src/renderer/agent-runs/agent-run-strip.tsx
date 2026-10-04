import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button.js'
import { describeAgentRun, describeAgentRunRemaining, type AgentRun } from '../../shared/agent-runs.js'
import { useAgentRunAction } from './use-agent-run-action.js'

// The one line above the composer that tells the user their chat is an agent: what cycle it is
// on, how much of its time limit is left, why it paused, and the three controls. Main owns the
// loop and the limits; this only shows them and asks main to change the run.

export type AgentRunStripProps = {
  run: AgentRun
  onPause: () => Promise<unknown>
  onResume: () => Promise<unknown>
  onStop: () => Promise<unknown>
}

/** The remaining time is shown to the minute, so a running clock is re-read this often. */
const CLOCK_MS = 15_000

/** The current time, ticking only while a run is counting down a time limit. */
function useCountdownClock(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(timer)
  }, [ticking])
  return now
}

export function AgentRunStrip({ run, onPause, onResume, onStop }: AgentRunStripProps): JSX.Element {
  const { busy, error, act } = useAgentRunAction()
  const running = run.status === 'running'
  const limit = run.maxCycles === null ? '' : ` of ${run.maxCycles}`
  const now = useCountdownClock(running && run.maxMinutes !== null)
  // While paused the clock stands still, so the record alone gives the time left.
  const remaining = describeAgentRunRemaining(run, running ? Math.max(now, run.updatedAt) : run.updatedAt)
  return (
    <div className="agent-run-strip" data-state={run.status} role="status" aria-live="polite">
      <span className="agent-run-strip-dot" aria-hidden="true" />
      <span className="agent-run-strip-text" title={describeAgentRun(run)}>
        <strong>{run.name || 'Agent'} {running ? 'running' : 'paused'}</strong>
        <span className="agent-run-strip-cycle"> · cycle {run.cycle}{limit}</span>
        {remaining ? <span className="agent-run-strip-time" aria-live="off"> · {remaining}</span> : null}
        {run.autonomous ? null : <span className="agent-run-strip-mode" title="Pauses after every cycle until you resume it"> · supervised</span>}
        {!running && run.reason ? <span className="agent-run-strip-reason"> · {run.reason}</span> : null}
        {error ? <span className="agent-run-strip-error"> · {error}</span> : null}
      </span>
      <span className="agent-run-strip-actions">
        {running ? (
          <Button type="button" variant="outline" size="xs" data-ui="chat.agent-pause" disabled={busy} onClick={() => void act(onPause)}>Pause</Button>
        ) : (
          <Button type="button" variant="outline" size="xs" className="agent-run-strip-resume" data-ui="chat.agent-resume" disabled={busy} onClick={() => void act(onResume)}>Resume</Button>
        )}
        <Button type="button" variant="ghost" size="xs" className="agent-run-strip-stop" data-ui="chat.agent-stop" disabled={busy} onClick={() => void act(onStop)}>Stop</Button>
      </span>
    </div>
  )
}
