import type { ChatTranscriptItem } from '../shared/chat.js'
import type { ToolPart } from '../components/ui/tool.js'

export type ActivityItem = Extract<ChatTranscriptItem, { type: 'command' | 'fileChange' | 'tool' }>
export type ReasoningItem = Extract<ChatTranscriptItem, { type: 'plan' | 'reasoning' }>
export type StandaloneItem = Exclude<ChatTranscriptItem, ActivityItem | ReasoningItem>

export type TranscriptRow =
  | { kind: 'item'; item: StandaloneItem }
  | { kind: 'activity'; id: string; items: ActivityItem[] }
  | { kind: 'reasoning'; id: string; items: ReasoningItem[] }

export type ActivityCluster = {
  id: string
  title: string
  items: ActivityItem[]
}

export function isActivity(item: ChatTranscriptItem): item is ActivityItem {
  return item.type === 'command' || item.type === 'fileChange' || item.type === 'tool'
}

export function isReasoning(item: ChatTranscriptItem): item is ReasoningItem {
  return item.type === 'plan' || item.type === 'reasoning'
}

/** Consecutive activity/reasoning in the same turn stays one row; commentary splits batches. */
export function transcriptRows(items: ChatTranscriptItem[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  for (const item of items) {
    if (isActivity(item)) {
      appendGrouped(rows, 'activity', item)
      continue
    }
    if (isReasoning(item)) {
      appendGrouped(rows, 'reasoning', item)
      continue
    }
    rows.push({ kind: 'item', item })
  }
  return rows
}

/** Pending thinking appears only until the turn has reasoning, tools, or an answer. */
export function visibleTranscriptRows(
  items: ChatTranscriptItem[],
  activeTurnId: string | null
): TranscriptRow[] {
  const rows = transcriptRows(items)
  if (!activeTurnId) return rows
  if (items.some((item) => item.turnId === activeTurnId && turnHasVisibleOutput(item))) {
    return rows
  }
  return [...rows, { kind: 'reasoning', id: activeTurnId, items: [] }]
}

function turnHasVisibleOutput(item: ChatTranscriptItem): boolean {
  if (isReasoning(item) || isActivity(item) || item.type === 'screenshot') return true
  return item.type === 'assistant' && Boolean(item.text)
}

export function activityHeadline(items: ActivityItem[]): string {
  if (items.length === 1) return activityTitle(items[0]!)
  let commands = 0
  let files = 0
  let searches = 0
  let tools = 0
  for (const item of items) {
    if (item.type === 'command') commands += 1
    else if (item.type === 'fileChange') files += Math.max(item.changes.length, 1)
    else if (isSearchTool(item)) searches += 1
    else tools += 1
  }
  const parts: string[] = []
  if (commands) parts.push(counted('Ran', commands, 'command', 'commands'))
  if (files) parts.push(counted('Edited', files, 'file', 'files'))
  if (searches) parts.push(searches === 1 ? 'Searched' : `Searched · ${searches}`)
  if (tools) parts.push(counted('Used', tools, 'tool', 'tools'))
  return parts.join(' · ')
}

export function activityTitle(item: ActivityItem): string {
  if (item.type === 'command') return commandTitle(item.command)
  if (item.type === 'fileChange') {
    if (item.changes.length === 1) return fileName(item.changes[0]!.path)
    if (item.changes.length > 1) return `${item.changes.length} files`
    return 'File changes'
  }
  return item.label
}

export function commandTitle(command: string, max = 64): string {
  const inner = unwrapShell(command).replace(/\s+/g, ' ').trim() || command.trim()
  if (inner.length <= max) return inner
  return `${inner.slice(0, max - 1).trimEnd()}…`
}

export function activityClusters(items: ActivityItem[]): ActivityCluster[] {
  const clusters: Array<ActivityCluster & { key: string }> = []
  for (const item of items) {
    const key = clusterKey(item)
    const last = clusters.at(-1)
    if (last?.key === key) last.items.push(item)
    else clusters.push({ id: item.id, title: '', items: [item], key })
  }
  return clusters.map((cluster) => ({
    id: cluster.id,
    title: cluster.items.length === 1
      ? activityTitle(cluster.items[0]!)
      : `${clusterLabel(cluster.items[0]!)} × ${cluster.items.length}`,
    items: cluster.items
  }))
}

export function clusterToolPart(cluster: ActivityCluster): ToolPart {
  if (cluster.items.length === 1) return toolPart(cluster.items[0]!)
  return {
    type: cluster.title,
    state: activityState(cluster.items),
    input: { steps: cluster.items.map(activityTitle) },
    output: clusterOutput(cluster.items),
    errorText: clusterError(cluster.items),
    toolCallId: cluster.items[0]!.id
  }
}

export function toolPart(item: ActivityItem): ToolPart {
  if (item.type === 'command') {
    return {
      type: commandTitle(item.command),
      state: toolState(item.status, item.exitCode),
      input: item.cwd ? { cwd: item.cwd } : undefined,
      output: item.output ? { output: item.output, exitCode: item.exitCode } : undefined,
      errorText: item.exitCode !== null && item.exitCode !== 0 ? `Command exited with code ${item.exitCode}` : undefined,
      toolCallId: item.id
    }
  }
  if (item.type === 'fileChange') {
    return {
      type: activityTitle(item),
      state: toolState(item.status, null),
      input: { files: item.changes.map(({ path, kind }) => ({ path, kind })) },
      output: item.changes.some((change) => change.diff)
        ? { diffs: item.changes.filter((change) => change.diff).map(({ path, diff }) => ({ path, diff })) }
        : undefined,
      toolCallId: item.id
    }
  }
  return {
    type: item.label,
    state: toolState(item.status, null),
    input: item.detail ? { detail: item.detail } : undefined,
    toolCallId: item.id
  }
}

export function activityState(items: ActivityItem[]): ToolPart['state'] {
  const states = items.map((item) => toolPart(item).state)
  if (states.includes('input-streaming')) return 'input-streaming'
  if (states.includes('output-error')) return 'output-error'
  if (states.includes('input-available')) return 'input-available'
  return 'output-available'
}

function appendGrouped(
  rows: TranscriptRow[],
  kind: 'activity' | 'reasoning',
  item: ActivityItem | ReasoningItem
): void {
  const key = item.turnId ?? `item:${item.id}`
  const last = rows.at(-1)
  if (last?.kind === kind && last.id === key) {
    last.items.push(item as never)
    return
  }
  rows.push({ kind, id: key, items: [item as never] })
}

function clusterKey(item: ActivityItem): string {
  if (item.type === 'command') return `command:${commandVerb(item.command)}`
  if (item.type === 'fileChange') return 'fileChange'
  return `tool:${item.label}`
}

function clusterLabel(item: ActivityItem): string {
  if (item.type === 'command') return commandVerb(item.command)
  if (item.type === 'fileChange') return 'files'
  return item.label
}

function commandVerb(command: string): string {
  const token = unwrapShell(command).replace(/\s+/g, ' ').trim().split(/\s+/)[0] ?? 'command'
  return fileName(token)
}

function unwrapShell(command: string): string {
  const match = command.match(/^(?:\/usr)?(?:\/bin\/)?(?:ba)?sh\s+-lc\s+([\s\S]+)$/i)
  if (!match) return command
  return unquote(match[1]!.trim())
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) {
    return value.slice(1, -1)
  }
  return value
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function counted(verb: string, count: number, one: string, many: string): string {
  return count === 1 ? `${verb} 1 ${one}` : `${verb} ${count} ${many}`
}

function isSearchTool(item: ActivityItem): boolean {
  return item.type === 'tool' && /search|lookup|web/i.test(item.label)
}

function toolState(status: string, exitCode: number | null): ToolPart['state'] {
  const normalized = status.toLowerCase()
  if (normalized.includes('progress') || normalized.includes('running')) return 'input-streaming'
  if (normalized.includes('fail') || normalized.includes('error') || (exitCode !== null && exitCode !== 0)) return 'output-error'
  if (normalized.includes('pending') || normalized.includes('request')) return 'input-available'
  return 'output-available'
}

function clusterOutput(items: ActivityItem[]): Record<string, unknown> | undefined {
  const results = items.flatMap((item) => {
    if (item.type === 'command' && item.output) return [{ title: activityTitle(item), output: item.output, exitCode: item.exitCode }]
    if (item.type === 'fileChange' && item.changes.length) {
      return [{ title: activityTitle(item), files: item.changes.map(({ path, kind }) => ({ path, kind })) }]
    }
    if (item.type === 'tool' && item.detail) return [{ title: item.label, detail: item.detail }]
    return []
  })
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
