import type { ToolGroupInfo, ToolInfo, ToolManifest, ToolStats, ToolSwitch, ToolTelemetrySnapshot } from '../../shared/tools.js'

export type ToolPreset = 'full' | 'read-only' | 'custom'

export type ToolRowModel = {
  tool: ToolInfo
  stat: ToolStats | null
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
export function groupTools(manifest: ToolManifest, telemetry: ToolTelemetrySnapshot | null): ToolGroupModel[] {
  const tools = manifest.namespaces.flatMap((namespace) => namespace.tools)
  return manifest.groups.flatMap((group) => {
    const rows = tools.filter((tool) => tool.group === group.id).map((tool) => rowModel(tool, telemetry?.stats ?? []))
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

function rowModel(tool: ToolInfo, stats: ToolStats[]): ToolRowModel {
  const stat = stats.find((entry) => entry.toolId === tool.id && entry.action === null) ?? null
  const failures = stat?.failures ?? 0
  const misuses = stat?.misuses ?? 0
  if (failures > misuses) return { tool, stat, note: plural(failures - misuses, 'error'), flag: 'bad' }
  if (misuses > 0) return { tool, stat, note: tool.enabled ? plural(misuses, 'misuse') : plural(misuses, 'refused call'), flag: 'warn' }
  return { tool, stat, note: '', flag: null }
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
