import { activityPhase, type ActivityPhase, type ChatTranscriptItem } from '../shared/chat.js'
import { commandKind, commandPhrase, firstStage, readFiles, tokenize, toolPhrase, unwrapShell } from './activity-phrase.js'

export type ActivityItem = Extract<ChatTranscriptItem, { type: 'command' | 'fileChange' | 'tool' }>
export type ReasoningItem = Extract<ChatTranscriptItem, { type: 'plan' | 'reasoning' }>
export type StandaloneItem = Exclude<ChatTranscriptItem, ActivityItem | ReasoningItem>

export type TranscriptRow =
  | { kind: 'item'; item: StandaloneItem }
  | { kind: 'background'; id: string; items: Extract<ChatTranscriptItem, { type: 'tool' }>[] }
  | { kind: 'activity'; id: string; items: ActivityItem[] }

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

export function transcriptRows(items: ChatTranscriptItem[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  const groups = new Map<string, Extract<TranscriptRow, { kind: 'background' }>>()
  const linked = new Set(items.flatMap((item) => item.type === 'tool' && item.background?.linkedToolId ? [item.background.linkedToolId] : []))
  for (const item of items) {
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
        rows.push({ kind: 'activity', id: turnKey, items: [item] })
      }
      continue
    }
    rows.push({ kind: 'item', item })
  }
  return rows
}

/** Message completion is not turn completion: tools may run after a settled message. */
export function turnActionMessageIds(
  items: ChatTranscriptItem[],
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

function sameTurn(last: Extract<TranscriptRow, { kind: 'activity' }>, item: ActivityItem): boolean {
  const lastTurn = last.items[0]?.turnId
  if (lastTurn && item.turnId) return lastTurn === item.turnId
  return !lastTurn || !item.turnId || lastTurn === item.turnId
}

function rowVisible(item: ChatTranscriptItem): boolean {
  if (isActivity(item)) return true
  if (item.type === 'assistant') return Boolean(item.text)
  if (item.type === 'user') return Boolean(item.text) || Boolean(item.attachments?.length)
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
  if (first.type === 'tool' && items.every((item) => item.type === 'tool' && item.label === first.label)) {
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
    const labels = new Set(tools.map((t) => t.label))
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

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function counted(verb: string, count: number, one: string, many: string): string {
  return count === 1 ? `${verb} 1 ${one}` : `${verb} ${count} ${many}`
}
