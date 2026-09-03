import type { ActivityPhase } from '../shared/chat.js'
import { toolPhrase, unwrapShell } from './activity-phrase.js'
import { activityTitle, itemPhase, type ActivityItem } from './transcript-rows.js'

// The step model behind an opened activity row: one entry per command, file change, or
// tool call, shaped for a status list rather than a tool payload. Everything here is pure
// so the component only lays it out and the tests read the words directly.

/** The card that opens under a step: what was invoked, what came back, and how it ended. */
export type StepBody = {
  /** Card heading: Shell, Edit, or the tool's label. */
  heading: string
  /** The command as typed, or the tool's arguments; null for a file edit, whose diff says it all. */
  invocation: string | null
  /** Whether the invocation is a shell command (drawn behind a `$` prompt). */
  shell: boolean
  output: string | null
  diffs: { path: string; diff: string }[]
  status: { tone: 'ok' | 'error' | 'live'; label: string }
}

export type ActivityStep = {
  id: string
  kind: ActivityItem['type']
  phase: ActivityPhase
  /** Leading verb: Ran, Edited, Searched. */
  verb: string
  /** What follows the verb on the same line: the raw command, the paths, or the tool's subject. */
  label: string
  /** The untruncated label for hover, or null when the label is already whole. */
  title: string | null
  /** Right-hand column: line delta, exit code, duration. */
  meta: string[]
  body: StepBody | null
  /** One sentence for the card's alert line when the step failed. */
  failure: string | null
}

export type ActivitySummary = {
  total: number
  done: number
  failed: number
  running: boolean
  elapsedMs: number | null
}

export const PHASE_LABEL: Record<ActivityPhase, string> = {
  running: 'running',
  pending: 'waiting',
  failed: 'failed',
  done: 'completed'
}

const MAX_DETAIL_CHARS = 160

export function activitySteps(items: ActivityItem[], now: number): ActivityStep[] {
  return items.map((item) => {
    const phase = itemPhase(item)
    const live = phase === 'running' || phase === 'pending'
    const { verb, label, title } = stepLine(item, live)
    return {
      id: item.id,
      kind: item.type,
      phase,
      verb,
      label,
      title,
      meta: stepMeta(item, phase, now),
      body: stepBody(item, phase),
      failure: phase === 'failed' ? stepFailure(item, label) : null
    }
  })
}

export function activitySummary(items: ActivityItem[], now: number): ActivitySummary {
  const phases = items.map(itemPhase)
  const running = phases.some((phase) => phase === 'running' || phase === 'pending')
  const starts = items.flatMap((item) => (item.startedAt === undefined ? [] : [item.startedAt]))
  let elapsedMs: number | null = null
  if (starts.length) {
    const start = Math.min(...starts)
    const end = running
      ? now
      : Math.max(...items.map((item) => item.finishedAt ?? item.startedAt ?? start))
    elapsedMs = Math.max(0, end - start)
  }
  return {
    total: items.length,
    done: phases.filter((phase) => phase === 'done').length,
    failed: phases.filter((phase) => phase === 'failed').length,
    running,
    elapsedMs
  }
}

/** "3 of 7 · 12s" while live, "6 done · 1 failed · 14s" once settled. */
export function summaryLabel(summary: ActivitySummary): string {
  const parts: string[] = []
  if (summary.running) {
    parts.push(`${summary.done + summary.failed} of ${summary.total}`)
  } else {
    parts.push(`${summary.done} done`)
  }
  if (summary.failed > 0) parts.push(`${summary.failed} failed`)
  if (summary.elapsedMs !== null) parts.push(formatDuration(summary.elapsedMs))
  return parts.join(' · ')
}

export function formatDuration(ms: number): string {
  const clamped = Math.max(0, ms)
  const tenths = Math.round(clamped / 100)
  if (tenths < 100) return `${(tenths / 10).toFixed(1)}s`
  const seconds = Math.round(clamped / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** Added and removed line counts across a set of unified diffs. */
export function diffCounts(diffs: { diff: string }[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const { diff } of diffs) {
    for (const line of diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added += 1
      else if (line.startsWith('-') && !line.startsWith('---')) removed += 1
    }
  }
  return { added, removed }
}

/**
 * Commands and file changes show the literal thing that happened after a plain verb, the
 * way a shell history would. Tool calls keep their phrase ("Searched the web") because
 * their raw arguments are JSON and belong in the body, not on the line.
 */
function stepLine(item: ActivityItem, live: boolean): { verb: string; label: string; title: string | null } {
  if (item.type === 'command') return withTitle(live ? 'Running' : 'Ran', unwrapShell(item.command))
  if (item.type === 'fileChange') return withTitle(live ? 'Editing' : 'Edited', item.changes.map((change) => change.path).join(', '))
  // A tool label with no phrase of its own ("closedai_ui · capture") has no verb to lift out.
  if (toolPhrase(item.label, 1, true) === toolPhrase(item.label, 1, false)) {
    return { verb: live ? 'Using' : 'Used', label: item.label, title: null }
  }
  const phrase = activityTitle(item, live)
  const space = phrase.indexOf(' ')
  if (space < 0) return { verb: phrase, label: '', title: null }
  return { verb: phrase.slice(0, space), label: phrase.slice(space + 1), title: null }
}

function withTitle(verb: string, raw: string): { verb: string; label: string; title: string | null } {
  const flat = raw.replace(/\s+/g, ' ').trim()
  const label = oneLine(flat) ?? ''
  return { verb, label, title: label === flat ? null : flat }
}

function stepMeta(item: ActivityItem, phase: ActivityPhase, now: number): string[] {
  const meta: string[] = []
  if (item.type === 'command' && item.exitCode !== null && item.exitCode !== 0) meta.push(`exit ${item.exitCode}`)
  if (item.type === 'fileChange') {
    const { added, removed } = diffCounts(item.changes)
    if (added || removed) meta.push(`+${added} −${removed}`)
  }
  if (item.startedAt !== undefined) {
    const end = item.finishedAt ?? (phase === 'running' || phase === 'pending' ? now : undefined)
    if (end !== undefined) meta.push(formatDuration(end - item.startedAt))
  }
  return meta
}

/**
 * Commands always open: the line truncates them, and the card is where the full command
 * and its output live. Edits open when there is a diff, tool calls when there are
 * arguments or a result to show.
 */
function stepBody(item: ActivityItem, phase: ActivityPhase): StepBody | null {
  const status = stepStatus(item, phase)
  if (item.type === 'command') {
    const output = item.output.replace(/\s+$/, '')
    return { heading: 'Shell', invocation: unwrapShell(item.command).trim(), shell: true, output: output || null, diffs: [], status }
  }
  if (item.type === 'fileChange') {
    const diffs = item.changes.filter((change) => change.diff.trim()).map(({ path, diff }) => ({ path, diff }))
    return diffs.length ? { heading: 'Edit', invocation: null, shell: false, output: null, diffs, status } : null
  }
  const invocation = item.detail.trim() || null
  const output = item.output?.trim() || null
  if (!invocation && !output) return null
  return { heading: item.label, invocation, shell: false, output, diffs: [], status }
}

function stepStatus(item: ActivityItem, phase: ActivityPhase): StepBody['status'] {
  if (phase === 'running') return { tone: 'live', label: 'Running' }
  if (phase === 'pending') return { tone: 'live', label: 'Waiting' }
  if (phase === 'failed') {
    if (item.type === 'command' && item.exitCode !== null && item.exitCode !== 0) return { tone: 'error', label: `Exit code ${item.exitCode}` }
    return { tone: 'error', label: 'Failed' }
  }
  return { tone: 'ok', label: 'Success' }
}

function stepFailure(item: ActivityItem, label: string): string {
  const subject = label || activityTitle(item, false)
  if (item.type === 'command' && item.exitCode !== null && item.exitCode !== 0) {
    return `${subject} exited with code ${item.exitCode}`
  }
  return `${subject} failed`
}

function oneLine(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > MAX_DETAIL_CHARS ? `${flat.slice(0, MAX_DETAIL_CHARS - 1).trimEnd()}…` : flat
}
