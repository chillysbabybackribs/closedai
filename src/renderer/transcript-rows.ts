import type { ChatTranscriptItem } from '../shared/chat.js'
import type { ToolPart } from '../components/ui/tool.js'
import { commandKind, commandPhrase, firstStage, readFiles, tokenize, toolPhrase, unwrapShell } from './activity-phrase.js'

export type ActivityItem = Extract<ChatTranscriptItem, { type: 'command' | 'fileChange' | 'tool' }>
export type ReasoningItem = Extract<ChatTranscriptItem, { type: 'plan' | 'reasoning' }>
export type StandaloneItem = Exclude<ChatTranscriptItem, ActivityItem | ReasoningItem>

export type TranscriptRow =
  | { kind: 'item'; item: StandaloneItem }
  | { kind: 'activity'; id: string; items: ActivityItem[] }

export type ActivityCluster = {
  id: string
  title: string
  items: ActivityItem[]
}

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
export function transcriptRows(items: ChatTranscriptItem[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  for (const item of items) {
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
  if (items.every((item) => item.type === 'tool' && item.label === items[0]!.label)) {
    return toolPhrase(items[0]!.label, items.length, running)
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

function activityDetail(item: ActivityItem): string {
  if (item.type === 'command') return commandTitle(item.command)
  return activityTitle(item)
}

export function activityClusters(items: ActivityItem[], running = false): ActivityCluster[] {
  const byKey = new Map<string, ActivityCluster & { key: string }>()
  for (const item of items) {
    const key = clusterKey(item)
    const existing = byKey.get(key)
    if (existing) {
      existing.items.push(item)
    } else {
      byKey.set(key, { id: item.id, title: '', items: [item], key })
    }
  }
  return Array.from(byKey.values()).map((cluster) => ({
    id: cluster.id,
    title: activityHeadline(cluster.items, running),
    items: cluster.items
  }))
}

export function clusterToolPart(cluster: ActivityCluster): ToolPart {
  if (cluster.items.length === 1) return toolPart(cluster.items[0]!)
  return {
    type: cluster.title,
    state: activityState(cluster.items),
    input: { steps: cluster.items.map(activityDetail) },
    output: clusterOutput(cluster.items),
    errorText: clusterError(cluster.items),
    toolCallId: cluster.items[0]!.id
  }
}

export function toolPart(item: ActivityItem): ToolPart {
  const running = item.status.toLowerCase().includes('progress') || item.status.toLowerCase().includes('running')
  if (item.type === 'command') {
    return {
      type: activityTitle(item, running),
      state: toolState(item.status, item.exitCode),
      input: {
        command: commandTitle(item.command),
        ...(item.cwd ? { cwd: item.cwd } : {})
      },
      output: item.output ? { output: item.output, exitCode: item.exitCode } : undefined,
      errorText: item.exitCode !== null && item.exitCode !== 0 ? `Command exited with code ${item.exitCode}` : undefined,
      toolCallId: item.id
    }
  }
  if (item.type === 'fileChange') {
    return {
      type: activityTitle(item, running),
      state: toolState(item.status, null),
      input: { files: item.changes.map(({ path, kind }) => ({ path, kind })) },
      output: item.changes.some((change) => change.diff)
        ? { diffs: item.changes.filter((change) => change.diff).map(({ path, diff }) => ({ path, diff })) }
        : undefined,
      toolCallId: item.id
    }
  }
  return {
    type: toolPhrase(item.label, 1, running),
    state: toolState(item.status, null),
    input: item.detail ? { detail: item.detail } : undefined,
    toolCallId: item.id
  }
}

export function activityState(items: ActivityItem[]): ToolPart['state'] {
  for (const item of items) {
    const state = getActivityItemState(item)
    if (state === 'input-streaming') return 'input-streaming'
    if (state === 'output-error') return 'output-error'
    if (state === 'input-available') return 'input-available'
  }
  return 'output-available'
}

function getActivityItemState(item: ActivityItem): ToolPart['state'] {
  if (item.type === 'command') return toolState(item.status, item.exitCode)
  if (item.type === 'fileChange') return toolState(item.status, null)
  return toolState(item.status, null)
}

function clusterKey(item: ActivityItem): string {
  if (item.type === 'command') return 'command'
  if (item.type === 'fileChange') return 'fileChange'
  return `tool:${item.label}`
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function counted(verb: string, count: number, one: string, many: string): string {
  return count === 1 ? `${verb} 1 ${one}` : `${verb} ${count} ${many}`
}

function toolState(status: string, exitCode: number | null): ToolPart['state'] {
  const normalized = status.toLowerCase()
  if (normalized.includes('progress') || normalized.includes('running')) return 'input-streaming'
  if (normalized.includes('fail') || normalized.includes('error') || (exitCode !== null && exitCode !== 0)) return 'output-error'
  if (normalized.includes('pending') || normalized.includes('request')) return 'input-available'
  return 'output-available'
}

function clusterOutput(items: ActivityItem[]): Record<string, unknown> | undefined {
  const results: Record<string, unknown>[] = []
  for (const item of items) {
    if (item.type === 'command' && item.output) {
      results.push({ title: activityDetail(item), output: item.output, exitCode: item.exitCode })
    } else if (item.type === 'fileChange' && item.changes.length) {
      results.push({ title: activityTitle(item), files: item.changes.map(({ path, kind }) => ({ path, kind })) })
    } else if (item.type === 'tool' && item.detail) {
      results.push({ title: item.label, detail: item.detail })
    }
  }
  return results.length ? { results } : undefined
}

function clusterError(items: ActivityItem[]): string | undefined {
  const failed = items.filter((item) => toolPart(item).state === 'output-error')
  if (!failed.length) return undefined
  return failed.map((item) => {
    if (item.type === 'command') return `${activityTitle(item)} exited with code ${item.exitCode}`
    return `${activityTitle(item)} failed`
  }).join('\n')
}
