import type { ToolErrorNote, ToolGroupInfo, ToolInfo, ToolManifest, ToolStats, ToolSwitch, ToolTelemetrySnapshot } from '../../shared/tools.js'

const DAY_MS = 86_400_000
/** A tool left on this long without a call, costing this much, is worth suggesting off. */
export const UNUSED_AFTER_MS = 14 * DAY_MS
export const SUGGEST_OFF_MIN_TOKENS = 120

export type ToolPreset = 'full' | 'read-only' | 'custom'

export type ToolRowModel = {
  tool: ToolInfo
  stat: ToolStats | null
  /** Failure notes for this tool, newest first. */
  errors: ToolErrorNote[]
  /** Set when the tool has been on and unused long enough that its cost is pure waste. */
  suggestOff: boolean
  /** Short note at the right of the row; empty when there is nothing worth opening the row for. */
  note: string
  /** Colour of the dot beside the name: red for errors, amber for a suggestion, none otherwise. */
  flag: 'bad' | 'warn' | null
}

export type ToolGroupModel = {
  group: ToolGroupInfo
  rows: ToolRowModel[]
  on: number
  state: 'on' | 'off' | 'mixed'
  /** Tokens the group's enabled tools add to every turn. */
  costTokens: number
}

/** Tools arranged by effect group, in the manifest's group order; empty groups are dropped. */
export function groupTools(manifest: ToolManifest, telemetry: ToolTelemetrySnapshot | null, now = Date.now()): ToolGroupModel[] {
  const tools = manifest.namespaces.flatMap((namespace) => namespace.tools)
  return manifest.groups.flatMap((group) => {
    const rows = tools.filter((tool) => tool.group === group.id).map((tool) => rowModel(tool, telemetry, now))
    if (rows.length === 0) return []
    const on = rows.filter((row) => row.tool.enabled).length
    return [{
      group,
      rows,
      on,
      state: on === 0 ? 'off' : on === rows.length ? 'on' : 'mixed',
      costTokens: rows.filter((row) => row.tool.enabled).reduce((sum, row) => sum + row.tool.costTokens, 0)
    }]
  })
}

function rowModel(tool: ToolInfo, telemetry: ToolTelemetrySnapshot | null, now: number): ToolRowModel {
  const stat = telemetry?.stats.find((entry) => entry.toolId === tool.id && entry.action === null) ?? null
  const errors = telemetry?.errors.filter((entry) => entry.toolId === tool.id) ?? []
  const suggestOff = isSuggestedOff(tool, stat, telemetry?.since ?? null, now)
  const base = { tool, stat, errors, suggestOff }
  const failures = stat?.failures ?? 0
  const misuses = stat?.misuses ?? 0
  if (failures > misuses) return { ...base, note: plural(failures - misuses, 'error'), flag: 'bad' }
  if (misuses > 0) return { ...base, note: tool.enabled ? plural(misuses, 'misuse') : plural(misuses, 'refused call'), flag: 'warn' }
  if (suggestOff) return { ...base, note: `unused ${unusedFor(stat, telemetry?.since ?? null, now)} · suggested off`, flag: 'warn' }
  return { ...base, note: '', flag: null }
}

/**
 * On, not deferred, costing real tokens, and not called for two weeks. Before timestamps have
 * been kept that long nothing is suggested: a tool cannot be "unused" for longer than counting.
 */
export function isSuggestedOff(tool: ToolInfo, stat: ToolStats | null, since: number | null, now: number): boolean {
  if (!tool.enabled || tool.deferLoading || tool.costTokens < SUGGEST_OFF_MIN_TOKENS) return false
  if (since === null || now - since < UNUSED_AFTER_MS) return false
  return stat?.lastCalledAt === null || stat === null || now - stat.lastCalledAt >= UNUSED_AFTER_MS
}

/** "6 wk", counting from the last call, or from when counting began for a tool never called. */
export function unusedFor(stat: ToolStats | null, since: number | null, now: number): string {
  const from = stat?.lastCalledAt ?? since ?? now
  return relativeSpan(now - from)
}

export function relativeSpan(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'moments'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days} d`
  return `${Math.floor(days / 7)} wk`
}

export function relativeTime(at: number | null, now: number): string {
  if (at === null) return 'never'
  return `${relativeSpan(now - at)} ago`
}

/** Rows worth switching off now, and what they cost together. */
export function suggestions(groups: ToolGroupModel[]): { rows: ToolRowModel[]; costTokens: number } {
  const rows = groups.flatMap((group) => group.rows.filter((row) => row.suggestOff))
  return { rows, costTokens: rows.reduce((sum, row) => sum + row.tool.costTokens, 0) }
}

/**
 * What "Send to chat for repair" puts in the composer: enough for a chat with the repository
 * open to find the tool and start from the real failure text. Never arguments or results.
 */
export function repairDraft(row: ToolRowModel, now: number): string {
  const { tool, stat, errors } = row
  const lines = [
    `Repair the \`${tool.id}\` tool (${tool.label}) in src/main/tools/.`,
    stat
      ? `Telemetry: ${plural(stat.calls, 'run')}, ${plural(stat.failures - stat.misuses, 'error')}, ${plural(stat.misuses, 'refused call')}, ${plural(stat.timeouts, 'timeout')}; last failed ${relativeTime(stat.lastFailedAt, now)}.`
      : 'Telemetry: no runs recorded.',
    ...(errors.length ? ['Recent failures, newest first:', ...errors.map((note) =>
      `- ${relativeTime(note.at, now)} · ${note.kind}${note.action ? ` · ${note.action}` : ''}: ${note.message}`)] : []),
    'Find the cause in the tool handler or its description, fix it, and run the tests beside that module.'
  ]
  return lines.join('\n')
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** Switchable ids behind one row: every verb of an action tool, or the plain tool itself. */
export function toolSwitches(tool: ToolInfo, enabled: boolean): ToolSwitch[] {
  return tool.actions.length > 0
    ? tool.actions.map((action) => ({ id: action.id, enabled }))
    : [{ id: tool.id, enabled }]
}

/** Which preset the current switches amount to. Custom is anything else. */
export function detectPreset(manifest: ToolManifest): ToolPreset {
  const tools = manifest.namespaces.flatMap((namespace) => namespace.tools)
  if (tools.every((tool) => tool.enabled)) return 'full'
  const readOnly = new Set(manifest.readOnlyIds)
  if (tools.every((tool) => tool.enabled === readOnly.has(tool.id))) return 'read-only'
  return 'custom'
}

/** The switches that put the registry into a named preset. */
export function presetSwitches(manifest: ToolManifest, preset: Exclude<ToolPreset, 'custom'>): ToolSwitch[] {
  const readOnly = new Set(manifest.readOnlyIds)
  return manifest.namespaces.flatMap((namespace) => namespace.tools.flatMap((tool) =>
    toolSwitches(tool, preset === 'full' || readOnly.has(tool.id))))
}

/** Toggling a group: any on turns them all off; none on turns them all on. */
export function groupSwitches(group: ToolGroupModel): ToolSwitch[] {
  const enabled = group.state === 'off'
  return group.rows.flatMap((row) => toolSwitches(row.tool, enabled))
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`
}
