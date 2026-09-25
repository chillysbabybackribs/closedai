// An agent run is a chat the app keeps driving: every time the provider ends a turn, the main
// process sends the next cycle unless the run is paused or stopped. The run record is the
// durable state behind the pane's agent strip, the closedai_app state projection, and restore
// after a relaunch. A run never restarts itself after a relaunch; it comes back paused.

import type { ChatContextUsage, ChatPlanUsage } from './chat.js'

export type AgentRunStatus = 'running' | 'paused'

/**
 * Running tallies main keeps as it watches the run's chat, so the Agents tab can say what the
 * run has done, what it costs, and what went wrong without reading the transcript. Counts span
 * every cycle since the start; readings are the latest the provider reported on this chat.
 */
export type AgentRunStats = {
  /** Commands, file edits, and tool calls the model has made. */
  steps: number
  /** Steps that failed (non-zero exit, tool error) plus error notices the chat surfaced. */
  errors: number
  /** File edits among the steps. */
  edits: number
  /** Provider thread changes since the start; each one re-sent the standing instructions. */
  rotations: number
  /** Wall-clock spent inside turns, summed over finished cycles. */
  turnMs: number
  /** When the turn in flight started; null between cycles. */
  turnStartedAt: number | null
  /** The last error text the chat surfaced, clipped. */
  lastError: string | null
  /** The model's latest completed reply, clipped: its own account of the cycle. */
  lastMessage: string | null
  /** Context window reading after the latest response: what every following cycle replays. */
  context: ChatContextUsage | null
  /** The account's plan windows as last reported on this chat; account-wide, not this run's alone. */
  plan: ChatPlanUsage | null
}

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
  /** The saved agent (src/shared/agent-library.ts) this run started from; null for a one-off. */
  agentId: string | null
  /** The saved agent's name at start time, shown on the strip; null for a one-off. */
  name: string | null
  stats: AgentRunStats
}

export type AgentRunStartOptions = {
  prompt: string
  maxCycles?: number | null
  agentId?: string | null
  name?: string | null
}

/** Pushed to the renderer whenever any run changes; the whole list, so a pane can look itself up. */
export type AgentRunsEvent = { runs: AgentRun[] }

/** Pause after this many consecutive failed turns so a broken provider is not hammered forever. */
export const AGENT_RUN_MAX_FAILURES = 5
/** Idle gap between a finished turn and the next cycle; the transcript settles before the next send. */
export const AGENT_RUN_CONTINUE_DELAY_MS = 1_500
/** Retry gaps after a failed turn, indexed by the consecutive failure count. */
export const AGENT_RUN_RETRY_DELAYS_MS = [3_000, 8_000, 20_000, 45_000, 90_000] as const
/** A driven send that starts no turn within this window counts as a failed turn. */
export const AGENT_RUN_TURN_START_TIMEOUT_MS = 60_000
/** Standing instructions longer than this are refused rather than silently clipped. */
export const AGENT_RUN_MAX_PROMPT_CHARS = 20_000
/** Reply and error excerpts kept on the run record; the tab clips further for display. */
export const AGENT_RUN_EXCERPT_CHARS = 240

export function emptyAgentRunStats(): AgentRunStats {
  return { steps: 0, errors: 0, edits: 0, rotations: 0, turnMs: 0, turnStartedAt: null, lastError: null, lastMessage: null, context: null, plan: null }
}

/** One line of prose from a reply or error: markdown markers and whitespace collapsed, then clipped. */
export function agentRunExcerpt(text: string, max = AGENT_RUN_EXCERPT_CHARS): string | null {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s?)/gm, '')
    .replace(/[*`]+/g, '')
    // Emphasis underscores only: keep the ones inside identifiers such as closedai_app.ui.
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat) return null
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

export function agentRunRetryDelay(failures: number): number {
  const index = Math.min(Math.max(failures, 1), AGENT_RUN_RETRY_DELAYS_MS.length) - 1
  return AGENT_RUN_RETRY_DELAYS_MS[index]!
}

/** What the runtime sends to start the next cycle; the full prompt returns after a thread change. */
export function agentCycleMessage(run: Pick<AgentRun, 'prompt' | 'cycle'>, threadChanged: boolean): string {
  const next = run.cycle + 1
  if (next === 1) return run.prompt
  if (threadChanged) {
    return `Cycle ${next}. This chat's context was rotated, so here are your standing instructions again:\n\n${run.prompt}\n\nStart cycle ${next} now.`
  }
  return `Cycle ${next}. Start the next cycle now under the same standing instructions. Do not sign off or ask whether to continue.`
}

/** One-line status for tab hints, tooltips, and the closedai_app state projection. */
export function describeAgentRun(run: Pick<AgentRun, 'status' | 'cycle' | 'reason'> & { name?: string | null }): string {
  const who = run.name || 'Agent'
  const base = run.status === 'running' ? `${who} running · cycle ${run.cycle}` : `${who} paused · cycle ${run.cycle}`
  return run.reason && run.status === 'paused' ? `${base} · ${run.reason}` : base
}

/** Shape check for a run read back from disk; anything malformed is treated as no run. */
export function normalizeAgentRun(candidate: unknown, chatId: string): AgentRun | null {
  if (!candidate || typeof candidate !== 'object') return null
  const record = candidate as Record<string, unknown>
  if (typeof record.prompt !== 'string' || record.prompt.trim().length === 0) return null
  const status: AgentRunStatus = record.status === 'running' ? 'running' : 'paused'
  const startedAt = positiveTime(record.startedAt) ?? Date.now()
  return {
    chatId,
    prompt: record.prompt,
    status,
    cycle: nonNegativeInt(record.cycle) ?? 0,
    maxCycles: positiveInt(record.maxCycles),
    startedAt,
    updatedAt: positiveTime(record.updatedAt) ?? startedAt,
    lastTurnEndedAt: positiveTime(record.lastTurnEndedAt),
    reason: typeof record.reason === 'string' && record.reason.length > 0 ? record.reason : null,
    failures: nonNegativeInt(record.failures) ?? 0,
    threadId: typeof record.threadId === 'string' && record.threadId.length > 0 ? record.threadId : null,
    agentId: typeof record.agentId === 'string' && record.agentId.length > 0 ? record.agentId : null,
    name: typeof record.name === 'string' && record.name.trim().length > 0 ? record.name.trim() : null,
    stats: normalizeStats(record.stats)
  }
}

function normalizeStats(candidate: unknown): AgentRunStats {
  const empty = emptyAgentRunStats()
  if (!candidate || typeof candidate !== 'object') return empty
  const record = candidate as Record<string, unknown>
  const context = record.context as Record<string, unknown> | null | undefined
  const plan = record.plan as Record<string, unknown> | null | undefined
  return {
    steps: nonNegativeInt(record.steps) ?? 0,
    errors: nonNegativeInt(record.errors) ?? 0,
    edits: nonNegativeInt(record.edits) ?? 0,
    rotations: nonNegativeInt(record.rotations) ?? 0,
    turnMs: nonNegativeInt(record.turnMs) ?? 0,
    // A turn that was in flight at quit never ends, so its start is dropped rather than counted forever.
    turnStartedAt: null,
    lastError: excerptOrNull(record.lastError),
    lastMessage: excerptOrNull(record.lastMessage),
    context: context && nonNegativeInt(context.usedTokens) !== null && positiveInt(context.contextWindow) !== null
      ? { usedTokens: Number(context.usedTokens), contextWindow: Number(context.contextWindow), percent: nonNegativeInt(context.percent) ?? 0 }
      : null,
    plan: plan && Array.isArray(plan.windows) ? (plan as unknown as ChatPlanUsage) : null
  }
}

function excerptOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, AGENT_RUN_EXCERPT_CHARS) : null
}

function positiveTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null
}

function positiveInt(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null
}

function nonNegativeInt(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null
}
