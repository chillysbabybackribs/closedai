import { activityPhase, type ActivityPhase, type ChatTranscriptItem } from '../shared/chat.js'
import {
  commandKind, commandPhrase, compactToolLabel, fileName, firstStage, readFiles, tokenize, toolPhrase, unwrapShell
} from './activity-phrase.js'

export type ActivityItem = Extract<ChatTranscriptItem, { type: 'command' | 'fileChange' | 'tool' }>
export type ReasoningItem = Extract<ChatTranscriptItem, { type: 'plan' | 'reasoning' }>
export type StandaloneItem = Exclude<ChatTranscriptItem, ActivityItem | ReasoningItem>
export type ScreenshotItem = Extract<ChatTranscriptItem, { type: 'screenshot' }>

export type TranscriptRow =
  | { kind: 'item'; item: StandaloneItem }
  | { kind: 'background'; id: string; items: Extract<ChatTranscriptItem, { type: 'tool' }>[] }
  /** `shots` are captures taken during the group; they show as a filmstrip under its line. */
  | { kind: 'activity'; id: string; items: ActivityItem[]; shots: ScreenshotItem[] }

export function isActivity(item: ChatTranscriptItem): item is ActivityItem {
  return item.type === 'command' || item.type === 'fileChange' || item.type === 'tool'
}

/**
 * Reasoning and plan items are dropped from the transcript entirely: the chat
 * shows what the model did and what it answered, never its thinking. This
 * predicate exists to exclude them, which is also why ReasoningItem is carved
 * out of StandaloneItem — no row kind renders one.
 */
export function isReasoning(item: ChatTranscriptItem): item is ReasoningItem {
  return item.type === 'plan' || item.type === 'reasoning'
}

/** Consecutive activity in the same turn stays one row. Commentary splits batches. */
/** Row index of the user message that starts the last turn. */
export function lastTurnRowStart(rows: readonly TranscriptRow[]): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!
    if (row.kind === 'item' && row.item.type === 'user') return index
  }
  return 0
}

/** Row index of the user message that starts the turn before `start`. */
export function previousTurnRowStart(rows: readonly TranscriptRow[], start: number): number {
  for (let index = start - 1; index >= 0; index -= 1) {
    const row = rows[index]!
    if (row.kind === 'item' && row.item.type === 'user') return index
  }
  return 0
}

/** Oldest row index that keeps at most `maxTurns` user turns ending at the tail. */
export function mountedTurnWindowStart(rows: readonly TranscriptRow[], maxTurns: number): number {
  const tail = lastTurnRowStart(rows)
  let windowStart = tail
  for (let turns = 1; turns < maxTurns; turns += 1) {
    const earlier = previousTurnRowStart(rows, windowStart)
    if (earlier === windowStart) break
    windowStart = earlier
  }
  return windowStart
}

/** Never mount more than `maxTurns`; drop the oldest revealed turn when the window overflows. */
export function clampVisibleStart(start: number, rows: readonly TranscriptRow[], maxTurns: number): number {
  return Math.min(lastTurnRowStart(rows), Math.max(start, mountedTurnWindowStart(rows, maxTurns)))
}

/** Keep the display boundary attached to a row when history is prepended or trimmed. */
export function transcriptRowKey(row: TranscriptRow | undefined): string | null {
  if (!row) return null
  return row.kind === 'item' ? `item:${row.item.id}` : `${row.kind}:${row.items[0]?.id}`
}

export function anchoredVisibleStart(anchor: string | null, rows: readonly TranscriptRow[], maxTurns: number): number {
  const index = anchor === null ? -1 : rows.findIndex((row) => transcriptRowKey(row) === anchor)
  return clampVisibleStart(index < 0 ? lastTurnRowStart(rows) : index, rows, maxTurns)
}

function normalizeAssistantText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/** Cursor often re-emits an assistant paragraph after a tool call; drop exact repeats in one turn. */
export function dedupeAssistantSegments(items: ChatTranscriptItem[]): ChatTranscriptItem[] {
  const out: ChatTranscriptItem[] = []
  for (const item of items) {
    if (item.type !== 'assistant') {
      out.push(item)
      continue
    }
    const turnId = item.turnId
    let priorIndex = -1
    for (let index = out.length - 1; index >= 0; index -= 1) {
      const prior = out[index]!
      if (prior.type === 'user') break
      if (prior.type === 'assistant' && prior.turnId === turnId) {
        priorIndex = index
        break
      }
    }
    if (priorIndex >= 0) {
      const prior = out[priorIndex]!
      if (prior.type === 'assistant') {
        const previous = normalizeAssistantText(prior.text)
        const next = normalizeAssistantText(item.text)
        if (!next) continue
        if (next === previous) continue
        if (previous && next.startsWith(previous)) {
          out[priorIndex] = item
          continue
        }
        if (previous.startsWith(next)) continue
      }
    }
    out.push(item)
  }
  return out
}

export function transcriptRows(items: ChatTranscriptItem[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  const visibleItems = dedupeAssistantSegments(items)
  const groups = new Map<string, Extract<TranscriptRow, { kind: 'background' }>>()
  const linked = new Set(items.flatMap((item) => item.type === 'tool' && item.background?.linkedToolId ? [item.background.linkedToolId] : []))
  for (const item of visibleItems) {
    if (linked.has(item.id)) continue
    if (item.type === 'tool' && item.background) {
      const key = item.turnId ?? 'background'
      let group = groups.get(key)
      if (!group) {
        group = { kind: 'background', id: key, items: [] }
        groups.set(key, group)
        rows.push(group)
      }
      group.items.push(item)
      continue
    }
    if (isReasoning(item) || !rowVisible(item)) continue
    if (isActivity(item)) {
      const turnKey = item.turnId ?? `activity:${item.id}`
      const last = rows.at(-1)
      if (last?.kind === 'activity' && sameTurn(last, item)) {
        last.items.push(item)
      } else {
        rows.push({ kind: 'activity', id: turnKey, items: [item], shots: [] })
      }
      continue
    }
    // A capture joins the step group that took it instead of breaking the reel with a card.
    if (item.type === 'screenshot' && item.surface !== 'generated_image') {
      const last = rows.at(-1)
      if (last?.kind === 'activity' && (!item.turnId || !last.items[0]?.turnId || item.turnId === last.items[0].turnId)) {
        last.shots.push(item)
        continue
      }
    }
    rows.push({ kind: 'item', item })
  }
  return rows
}

export type TurnHead = {
  key: string
  /** The turn still running: its header counts up and nothing folds yet. */
  live: boolean
  /** Settled with an answer after its steps, or live with more than its stage: the header opens the fold. */
  foldable: boolean
  /** While live, what holds still under the header; null once the turn settles. */
  stage: TurnStage | null
  steps: number
  /** Wall-clock bounds from item timings, when the provider or app stamped any. */
  startedAt: number | null
  endedAt: number | null
}

/**
 * A live turn's fixed area: the newest text on top, the newest step group beneath it. Row
 * indices are -1 when the turn has none yet. `textOpen` marks text written after the newest
 * step: it may be the answer, so it shows at full height until a step follows it.
 */
export type TurnStage = { step: number; text: number; textOpen: boolean }

export type TurnLayout = {
  /** The header shown under each user row, keyed by that row's index. */
  heads: Map<number, TurnHead>
  /** Rows a settled turn folds away, mapped to that turn's key. */
  folds: Map<number, string>
}

/**
 * Each turn reads as a header ("Working for 12s", then "Worked for 38s") over its process:
 * the step groups, captures, and commentary between the prompt and the answer. While the turn
 * runs, its whole process folds into the stage, which keeps one place for the newest step and
 * one for the newest text, so the prompt stays in view and nothing changes position. Once the
 * turn settles, the process folds under the header and only the final answer stays in view.
 * Only the last turn can be live.
 */
export function turnLayout(rows: readonly TranscriptRow[], running: boolean): TurnLayout {
  const heads = new Map<number, TurnHead>()
  const folds = new Map<number, string>()
  const starts = rows.flatMap((row, index) => row.kind === 'item' && row.item.type === 'user' ? [index] : [])
  starts.forEach((start, n) => {
    const end = starts[n + 1] ?? rows.length
    const user = rows[start] as Extract<TranscriptRow, { kind: 'item' }>
    const live = running && n === starts.length - 1
    let steps = 0
    let first = Infinity
    let last = -Infinity
    let answer = -1
    let group = -1
    for (let index = start + 1; index < end; index += 1) {
      const row = rows[index]!
      if (row.kind === 'activity') {
        group = index
        steps += row.items.length
        for (const item of row.items) {
          if (item.startedAt !== undefined) first = Math.min(first, item.startedAt)
          last = Math.max(last, item.finishedAt ?? item.startedAt ?? last)
        }
      } else if (row.kind === 'item' && row.item.type === 'assistant') {
        answer = index
        if (row.item.createdAt !== undefined) {
          first = Math.min(first, row.item.createdAt)
          last = Math.max(last, row.item.createdAt)
        }
      }
    }
    if (!live && steps === 0) return
    const key = user.item.turnId ?? `user:${user.item.id}`
    let foldable = false
    // Text after the newest step may be the answer; it is commentary only once a step follows
    // it, or when the provider labels it so.
    const textRow = rows[answer]
    const commentary = textRow?.kind === 'item' && textRow.item.type === 'assistant' && textRow.item.phase === 'commentary'
    const stage: TurnStage | null = live ? { step: group, text: answer, textOpen: answer > group && !commentary } : null
    const foldEnd = live ? end : answer
    if (live || answer > start) {
      for (let index = start + 1; index < foldEnd; index += 1) {
        if (!isProcessRow(rows[index]!)) continue
        folds.set(index, key)
        if (index !== stage?.step && index !== stage?.text) foldable = true
      }
    }
    heads.set(start, {
      key,
      live,
      foldable,
      stage,
      steps,
      startedAt: Number.isFinite(first) ? first : null,
      endedAt: Number.isFinite(last) ? last : null
    })
  })
  return { heads, folds }
}

function isProcessRow(row: TranscriptRow): boolean {
  if (row.kind === 'activity') return true
  if (row.kind !== 'item') return false
  return row.item.type === 'assistant' || (row.item.type === 'screenshot' && row.item.surface !== 'generated_image')
}

/** Message completion is not turn completion: tools may run after a settled message. */
export function turnActionMessageIds(
  items: readonly ChatTranscriptItem[],
  activeTurnId?: string | null,
  running = Boolean(activeTurnId)
): Set<string> {
  const lastAnswers = new Map<string, Extract<ChatTranscriptItem, { type: 'assistant' }>>()
  const unfinished = new Set<string>()
  let fallbackKey = 'unattributed'
  let lastKey: string | null = null
  for (const item of items) {
    if (item.type === 'user') fallbackKey = item.turnId ?? `user:${item.id}`
    const key = item.turnId ?? fallbackKey
    lastKey = key
    if (item.turnId === activeTurnId && activeTurnId) unfinished.add(key)
    if ('streaming' in item && item.streaming) unfinished.add(key)
    if (isActivity(item) && ['running', 'pending'].includes(itemPhase(item))) unfinished.add(key)
    if (item.type === 'assistant' && item.text.trim()) lastAnswers.set(key, item)
  }
  // Providers can omit turn ids; the current tail still belongs to the running turn.
  if (running && lastKey) unfinished.add(lastKey)
  return new Set([...lastAnswers].flatMap(([key, item]) =>
    !unfinished.has(key) && !item.streaming && item.phase !== 'commentary' ? [item.id] : []
  ))
}

/** Latest assistant message that can carry "Continue in new chat" (same rule as the transcript action row). */
export function latestContinueEligibleMessageId(
  items: readonly ChatTranscriptItem[],
  activeTurnId: string | null | undefined,
  running: boolean
): string | null {
  const eligible = turnActionMessageIds(items, activeTurnId, running || Boolean(activeTurnId))
  let latest: string | null = null
  for (const item of items) {
    if (eligible.has(item.id)) latest = item.id
  }
  return latest
}

function sameTurn(last: Extract<TranscriptRow, { kind: 'activity' }>, item: ActivityItem): boolean {
  const lastTurn = last.items[0]?.turnId
  if (lastTurn && item.turnId) return lastTurn === item.turnId
  return !lastTurn || !item.turnId || lastTurn === item.turnId
}

export function hiddenTranscriptNotice(item: Extract<ChatTranscriptItem, { type: 'notice' }>): boolean {
  if (item.tone !== 'info') return false
  if (item.text.startsWith('Continuing from')) return true
  return item.text.includes('provider context will rotate while idle')
}

function rowVisible(item: ChatTranscriptItem): boolean {
  if (isActivity(item)) return true
  if (item.type === 'assistant') return Boolean(item.text)
  if (item.type === 'user') return Boolean(item.text) || Boolean(item.attachments?.length)
  if (item.type === 'notice' && hiddenTranscriptNotice(item)) return false
  return true
}

export function activityHeadline(items: ActivityItem[], running = false): string {
  if (items.length === 1) return activityTitle(items[0]!, running)
  if (items.every((item) => item.type === 'command')) return commandHeadline(items, running)
  if (items.every((item) => item.type === 'fileChange')) {
    const files = items.reduce((count, item) => (
      item.type === 'fileChange' ? count + Math.max(item.changes.length, 1) : count
    ), 0)
    return counted(running ? 'Editing' : 'Edited', files, 'file', 'files')
  }
  const first = items[0]!
  if (
    first.type === 'tool'
    && items.every((item) => item.type === 'tool' && compactToolLabel(item.label) === compactToolLabel(first.label))
  ) {
    return toolPhrase(first.label, items.length, running)
  }
  return mixedHeadline(items, running)
}

function mixedHeadline(items: ActivityItem[], running = false): string {
  const parts: string[] = []
  const fileChanges = items.filter((item) => item.type === 'fileChange')
  if (fileChanges.length > 0) {
    const files = fileChanges.reduce((count, item) => (
      item.type === 'fileChange' ? count + Math.max(item.changes.length, 1) : count
    ), 0)
    parts.push(counted(running ? 'Editing' : 'Edited', files, 'file', 'files'))
  }

  const commands = items.filter((item) => item.type === 'command')
  if (commands.length > 0) {
    parts.push(commandHeadline(commands, running))
  }

  const tools = items.filter((item) => item.type === 'tool')
  if (tools.length > 0) {
    const labels = new Set(tools.map((item) => compactToolLabel(item.label)))
    if (labels.size === 1) {
      parts.push(toolPhrase(tools[0]!.label, tools.length, running))
    } else {
      parts.push(counted(running ? 'Using' : 'Used', tools.length, 'tool', 'tools'))
    }
  }

  return parts.length ? parts.join(', ') : counted(running ? 'Running' : 'Ran', items.length, 'step', 'steps')
}

export function activityTitle(item: ActivityItem, running = false): string {
  if (item.type === 'command') return commandPhrase(item.command, running)
  if (item.type === 'fileChange') {
    const verb = running ? 'Editing' : 'Edited'
    if (item.changes.length === 1) return `${verb} ${fileName(item.changes[0]!.path)}`
    if (item.changes.length > 1) return `${verb} ${item.changes.length} files`
    return `${verb} files`
  }
  return toolPhrase(item.label, 1, running)
}

function commandHeadline(items: ActivityItem[], running = false): string {
  // One command describes itself; only a group needs counting.
  if (items.length === 1) return activityTitle(items[0]!, running)
  const kinds = new Set(items.map((item) => item.type === 'command' ? commandKind(item.command) : 'run'))
  if (kinds.size === 1 && kinds.has('read')) return readHeadline(items, running)
  if (kinds.size === 1 && kinds.has('search')) return `${running ? 'Searching' : 'Searched'} ${items.length} times`
  if (kinds.size === 1 && kinds.has('list')) return counted(running ? 'Listing' : 'Listed', items.length, 'path', 'paths')
  if (kinds.size === 1 && kinds.has('test')) return running ? 'Running tests' : 'Ran tests'
  return counted(running ? 'Running' : 'Ran', items.length, 'command', 'commands')
}

function readHeadline(items: ActivityItem[], running = false): string {
  const files: string[] = []
  for (const item of items) {
    if (item.type === 'command') {
      const stage = firstStage(unwrapShell(item.command))
      const argv = tokenize(stage)
      const verb = fileName(argv[0] ?? '').toLowerCase()
      files.push(...readFiles(argv.slice(1), verb))
    }
  }
  const action = running ? 'Reading' : 'Read'
  const names = files.map(fileName)
  if (names.length === 1) return `${action} ${names[0]!}`
  if (names.length > 1 && names.length <= 3) return `${action} ${names.join(', ')}`
  if (names.length > 3) return `${action} ${names.slice(0, 3).join(', ')} (+${names.length - 3} more)`
  return counted(action, items.length, 'file', 'files')
}

export function commandTitle(command: string, max = 64): string {
  const inner = unwrapShell(command).replace(/\s+/g, ' ').trim() || command.trim()
  if (inner.length <= max) return inner
  return `${inner.slice(0, max - 1).trimEnd()}…`
}

/** The row-level phase: one running step keeps the row live, one failure marks it failed. */
export function activityState(items: ActivityItem[]): ActivityPhase {
  const phases = items.map(itemPhase)
  if (phases.includes('running')) return 'running'
  if (phases.includes('failed')) return 'failed'
  if (phases.includes('pending')) return 'pending'
  return 'done'
}

export function itemPhase(item: ActivityItem): ActivityPhase {
  return activityPhase(item.status, item.type === 'command' ? item.exitCode : null)
}

function counted(verb: string, count: number, one: string, many: string): string {
  return count === 1 ? `${verb} 1 ${one}` : `${verb} ${count} ${many}`
}
