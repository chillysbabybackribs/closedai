import type { ChatTranscriptItem } from '../shared/chat.js'
import type { ToolPart } from '../components/ui/tool.js'
import { commandKind, commandPhrase, toolPhrase, unwrapShell } from './activity-phrase.js'

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

/** Consecutive same-identity activity stays one row. Invisible placeholders do not split it. */
export function transcriptRows(items: ChatTranscriptItem[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  for (const item of items) {
    if (isReasoning(item) || !rowVisible(item)) continue
    if (isActivity(item)) {
      const key = clusterKey(item)
      const last = rows.at(-1)
      if (last?.kind === 'activity' && last.id === key) last.items.push(item)
      else rows.push({ kind: 'activity', id: key, items: [item] })
      continue
    }
    rows.push({ kind: 'item', item })
  }
  return rows
}

/**
 * One thinking slot per turn, pinned after the user prompt, so it does not
 * mount/unmount as tools and answers stream in.
 */
export function visibleTranscriptRows(
  items: ChatTranscriptItem[],
  activeTurnId: string | null
): TranscriptRow[] {
  const reasoning = new Map<string, ReasoningItem[]>()
  for (const item of items) {
    if (!isReasoning(item) || (!item.text && !item.streaming)) continue
    const key = turnKey(item.turnId, activeTurnId) ?? `item:${item.id}`
    const group = reasoning.get(key) ?? []
    group.push(item)
    reasoning.set(key, group)
  }

  const rows: TranscriptRow[] = []
  const placed = new Set<string>()

  const placeThought = (turnId: string | null): void => {
    const key = turnKey(turnId, activeTurnId)
    if (!key || placed.has(key)) return
    placed.add(key)
    const grouped = reasoning.get(key) ?? []
    if (grouped.length || key === activeTurnId) {
      rows.push({ kind: 'reasoning', id: key, items: grouped })
    }
  }

  for (const item of items) {
    if (isReasoning(item) || !rowVisible(item)) continue
    if (item.type === 'user') {
      rows.push({ kind: 'item', item })
      placeThought(item.turnId)
      continue
    }
    placeThought(item.turnId)
    if (isActivity(item)) {
      const key = clusterKey(item)
      const last = rows.at(-1)
      if (last?.kind === 'activity' && last.id === key) last.items.push(item)
      else rows.push({ kind: 'activity', id: key, items: [item] })
      continue
    }
    rows.push({ kind: 'item', item })
  }

  if (activeTurnId) placeThought(activeTurnId)
  return rows
}

function turnKey(turnId: string | null, activeTurnId: string | null): string | null {
  return turnId || activeTurnId
}

function rowVisible(item: ChatTranscriptItem): boolean {
  if (isActivity(item)) return true
  if (isReasoning(item)) return Boolean(item.text) || item.streaming
  if (item.type === 'assistant') return Boolean(item.text)
  if (item.type === 'user') return Boolean(item.text) || Boolean(item.attachments?.length)
  return true
}

export function activityHeadline(items: ActivityItem[]): string {
  if (items.length === 1) return activityTitle(items[0]!)
  const first = items[0]!
  if (first.type === 'tool') return toolPhrase(first.label, items.length)
  if (first.type === 'command') return commandHeadline(items)
  const files = items.reduce((count, item) => (
    item.type === 'fileChange' ? count + Math.max(item.changes.length, 1) : count
  ), 0)
  return counted('Edited', files, 'file', 'files')
}

export function activityTitle(item: ActivityItem): string {
  if (item.type === 'command') return commandPhrase(item.command)
  if (item.type === 'fileChange') {
    if (item.changes.length === 1) return `Edited ${fileName(item.changes[0]!.path)}`
    if (item.changes.length > 1) return `Edited ${item.changes.length} files`
    return 'Edited files'
  }
  return toolPhrase(item.label)
}

function commandHeadline(items: ActivityItem[]): string {
  const kinds = new Set(items.map((item) => item.type === 'command' ? commandKind(item.command) : 'run'))
  if (kinds.size === 1 && kinds.has('read')) return counted('Read', items.length, 'file', 'files')
  if (kinds.size === 1 && kinds.has('search')) return `Searched ${items.length} times`
  if (kinds.size === 1 && kinds.has('list')) return counted('Listed', items.length, 'path', 'paths')
  if (kinds.size === 1 && kinds.has('test')) return 'Ran tests'
  return counted('Ran', items.length, 'command', 'commands')
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
    title: activityHeadline(cluster.items),
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
  if (item.type === 'command') {
    return {
      type: activityTitle(item),
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
      results.push({ title: activityTitle(item), output: item.output, exitCode: item.exitCode })
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
