import type { AgentRun, AgentRunStats } from '../../shared/agent-runs.js'
import { formatDuration } from '../activity-steps.js'
import { resetNote } from '../context-meter.js'

// The two or three sentences under a run row: what the run has done and for how long, what a
// cycle costs and why, and what went wrong. Built only from the run record's tallies, so a run
// whose chat is not mounted reads the same as one that is. Pure, so the wording is testable.

export type AgentRunBriefLine = { kind: 'progress' | 'reply' | 'cost' | 'error'; text: string }

/** Reply excerpts are clipped again for the row; the record keeps a longer one for tooltips. */
const REPLY_CHARS = 140
/** Past this share of the window the cost line says a rotation is near, as the context meter does. */
const HOT_PERCENT = 75

export function agentRunBrief(run: AgentRun, now: number): AgentRunBriefLine[] {
  const lines: AgentRunBriefLine[] = [{ kind: 'progress', text: progressLine(run, now) }]
  if (run.stats.lastMessage) lines.push({ kind: 'reply', text: `Last reply: “${clip(run.stats.lastMessage, REPLY_CHARS)}”` })
  lines.push({ kind: 'cost', text: costLine(run.stats, now) })
  const error = errorLine(run.stats)
  if (error) lines.push({ kind: 'error', text: error })
  return lines
}

/** "Cycle 4 of 10 has been working 1m 20s. 12 steps and 3 file edits so far, 40m in total." */
function progressLine(run: AgentRun, now: number): string {
  const { stats } = run
  const work = workPhrase(stats)
  const total = stats.turnMs + (stats.turnStartedAt ? Math.max(0, now - stats.turnStartedAt) : 0)
  const totalPhrase = total > 0 ? ` over ${formatDuration(total)} of model time` : ''
  if (run.status === 'running' && stats.turnStartedAt) {
    const cycle = run.maxCycles === null ? `Cycle ${run.cycle}` : `Cycle ${run.cycle} of ${run.maxCycles}`
    return `${cycle} has been working ${formatDuration(now - stats.turnStartedAt)}. ${work}${totalPhrase}.`
  }
  const done = Math.max(0, run.status === 'running' ? run.cycle - 1 : run.cycle)
  if (done === 0) return 'No cycle has finished yet.'
  const ended = run.lastTurnEndedAt ? `, the last ${ago(now - run.lastTurnEndedAt)}` : ''
  return `${done} ${done === 1 ? 'cycle' : 'cycles'} finished${ended}. ${work}${totalPhrase}.`
}

function workPhrase(stats: AgentRunStats): string {
  if (stats.steps === 0) return 'No commands, edits or tool calls yet'
  const steps = `${stats.steps} ${stats.steps === 1 ? 'step' : 'steps'}`
  const edits = stats.edits > 0 ? ` including ${stats.edits} file ${stats.edits === 1 ? 'edit' : 'edits'}` : ''
  return `${steps}${edits}`
}

/** "Each cycle re-sends 61k tokens of context (31% of the window). 5-hour window at 42%, resets in 2h." */
function costLine(stats: AgentRunStats, now: number): string {
  const parts: string[] = []
  if (stats.context) {
    const { usedTokens, contextWindow, percent } = stats.context
    const share = contextWindow > 0 ? ` (${percent}% of the ${formatTokens(contextWindow)} window` + (percent >= HOT_PERCENT ? ', a rotation is near)' : ')') : ''
    parts.push(`Each cycle re-sends ${formatTokens(usedTokens)} tokens of context${share}, growing with every step`)
  } else {
    parts.push('The provider has not reported context usage yet')
  }
  if (stats.rotations > 0) {
    parts.push(`the context was rotated ${stats.rotations === 1 ? 'once' : `${stats.rotations} times`}, re-sending the instructions each time`)
  }
  const windows = stats.plan?.windows ?? []
  if (windows.length > 0) {
    parts.push(windows.slice(0, 2).map((window) =>
      `${window.label} plan window at ${window.percent}%${window.resetsAt ? `, resets in ${resetNote(window.resetsAt, now)}` : ''}`).join('; '))
  }
  return `${parts.join('. ').replace(/\. ([a-z])/g, (_, c: string) => `. ${c.toUpperCase()}`)}.`
}

/** "2 of 12 steps failed. Last: npm test exited with code 1." */
function errorLine(stats: AgentRunStats): string | null {
  if (stats.errors === 0 && !stats.lastError) return null
  const count = stats.errors === 1 ? '1 error' : `${stats.errors} errors`
  const scope = stats.steps > 0 ? ` across ${stats.steps} steps` : ''
  return stats.lastError ? `${count}${scope}. Last: ${stats.lastError}` : `${count}${scope}.`
}

function ago(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s ago`
  return `${formatDuration(ms).replace(/ \d+s$/, '')} ago`
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}k` : String(tokens)
}
