import type { JSX } from 'react'
import { Button } from '../../components/ui/button.js'
import { describeAgentRun, type AgentRun } from '../../shared/agent-runs.js'
import { useAgentRunAction } from './use-agent-run-action.js'

// The one line above the composer that tells the user their chat is an agent: what cycle it is
// on, why it paused, and the three controls. Main owns the loop; this only asks it to change.

export type AgentRunStripProps = {
  run: AgentRun
  onPause: () => Promise<unknown>
  onResume: () => Promise<unknown>
  onStop: () => Promise<unknown>
}

export function AgentRunStrip({ run, onPause, onResume, onStop }: AgentRunStripProps): JSX.Element {
  const { busy, error, act } = useAgentRunAction()
  const running = run.status === 'running'
  const limit = run.maxCycles === null ? '' : ` of ${run.maxCycles}`
  return (
    <div className="agent-run-strip" data-state={run.status} role="status" aria-live="polite">
      <span className="agent-run-strip-dot" aria-hidden="true" />
      <span className="agent-run-strip-text" title={describeAgentRun(run)}>
        <strong>{run.name || 'Agent'} {running ? 'running' : 'paused'}</strong>
        <span className="agent-run-strip-cycle"> · cycle {run.cycle}{limit}</span>
        {!running && run.reason ? <span className="agent-run-strip-reason"> · {run.reason}</span> : null}
        {error ? <span className="agent-run-strip-error"> · {error}</span> : null}
      </span>
      <span className="agent-run-strip-actions">
        {running ? (
          <Button type="button" variant="outline" size="xs" data-ui="chat.agent-pause" disabled={busy} onClick={() => void act(onPause)}>Pause</Button>
        ) : (
          <Button type="button" variant="outline" size="xs" data-ui="chat.agent-resume" disabled={busy} onClick={() => void act(onResume)}>Resume</Button>
        )}
        <Button type="button" variant="ghost" size="xs" data-ui="chat.agent-stop" disabled={busy} onClick={() => void act(onStop)}>Stop</Button>
      </span>
    </div>
  )
}
