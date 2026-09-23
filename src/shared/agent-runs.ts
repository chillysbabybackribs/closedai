// An agent run is a chat the app keeps driving: every time the provider ends a turn, the main
// process sends the next cycle unless the run is paused or stopped. The run record is the
// durable state behind the pane's agent strip, the closedai_app state projection, and restore
// after a relaunch. A run never restarts itself after a relaunch; it comes back paused.

export type AgentRunStatus = 'running' | 'paused'

export type AgentRun = {
  /** The chat's stable store id, equal to its pane id while attached. */
  chatId: string
  /** Standing instructions: the first message, and re-sent whenever the provider thread changes. */
  prompt: string
  status: AgentRunStatus
  /** Turns the runtime has driven, counting the first prompt as cycle 1. */
  cycle: number
  /** Stop and pause with a reason when this many cycles have run; null means no limit. */
  maxCycles: number | null
  startedAt: number
  updatedAt: number
  lastTurnEndedAt: number | null
  /** Why the run paused when the runtime did it, or a short note about the last user action. */
  reason: string | null
  /** Consecutive turns that ended in an error or produced nothing; reset by a healthy turn. */
  failures: number
  /** The provider thread the last driven turn used; a change means a rotation or handoff. */
  threadId: string | null
}

export type AgentRunStartOptions = {
  prompt: string
  maxCycles?: number | null
}

/** Pause after this many consecutive failed turns so a broken provider is not hammered forever. */
export const AGENT_RUN_MAX_FAILURES = 5
/** Idle gap between a finished turn and the next cycle; the transcript settles before the next send. */
export const AGENT_RUN_CONTINUE_DELAY_MS = 1_500
/** Retry gaps after a failed turn, indexed by the consecutive failure count. */
export const AGENT_RUN_RETRY_DELAYS_MS = [3_000, 8_000, 20_000, 45_000, 90_000] as const

export function agentRunRetryDelay(failures: number): number {
  const index = Math.min(Math.max(failures, 1), AGENT_RUN_RETRY_DELAYS_MS.length) - 1
  return AGENT_RUN_RETRY_DELAYS_MS[index]!
}

/** What the runtime sends to start the next cycle; the full prompt returns after a thread change. */
export function agentCycleMessage(run: Pick<AgentRun, 'prompt' | 'cycle'>, threadChanged: boolean): string {
  const next = run.cycle + 1
  if (threadChanged) {
    return `Cycle ${next}. This chat's context was rotated, so here are your standing instructions again:\n\n${run.prompt}\n\nStart cycle ${next} now.`
  }
  return `Cycle ${next}. Start the next cycle now under the same standing instructions. Do not sign off or ask whether to continue.`
}

/** One-line status for tab hints, tooltips, and the closedai_app state projection. */
export function describeAgentRun(run: Pick<AgentRun, 'status' | 'cycle' | 'reason'>): string {
  const base = run.status === 'running' ? `Agent running · cycle ${run.cycle}` : `Agent paused · cycle ${run.cycle}`
  return run.reason && run.status === 'paused' ? `${base} · ${run.reason}` : base
}
