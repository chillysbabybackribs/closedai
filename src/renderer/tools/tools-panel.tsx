import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '../../components/ui/button.js'
import { Switch } from '../../components/ui/switch.js'
import { cn } from '../../lib/utils.js'
import type { ToolEffect } from '../../shared/tools.js'
import { ToolRow } from './tool-row.js'
import { useToolsController } from './tools-controller.js'
import {
  detectPreset,
  formatTokens,
  groupSwitches,
  groupTools,
  plural,
  presetSwitches,
  repairDraft,
  suggestions,
  toolSwitches,
  type ToolGroupModel,
  type ToolPreset
} from './tools-model.js'

export type ToolsPanelProps = {
  /** The view tab is in front; a hidden panel stops refreshing. */
  active: boolean
  /** Hands the scoped chat a repair request for a tool; the pane owns its composer. */
  onSendToChat: (text: string) => void
}

const PRESETS: Array<{ id: ToolPreset; label: string }> = [
  { id: 'full', label: 'Full' },
  { id: 'read-only', label: 'Read-only' },
  { id: 'custom', label: 'Custom' }
]

/** The effect label is coloured text, never a pill: green observes, amber acts, red is dangerous. */
const EFFECT_TEXT: Record<ToolEffect, string> = {
  'reads-web': 'text-[color:var(--ok-ink)]',
  'acts-in-browser': 'text-[color:var(--warning,#c58b45)]',
  'controls-app': 'text-[color:var(--warning,#c58b45)]',
  'reads-secrets': 'text-destructive',
  'runs-native': 'text-destructive'
}

const RAIL_BAR: Record<ToolEffect, string> = {
  'reads-web': 'tools-rail-bar-reads-web',
  'acts-in-browser': 'tools-rail-bar-acts-in-browser',
  'controls-app': 'tools-rail-bar-controls-app',
  'reads-secrets': 'tools-rail-bar-reads-secrets',
  'runs-native': 'tools-rail-bar-runs-native'
}

function failingOn(group: ToolGroupModel): number {
  return group.rows.filter((row) => row.tool.enabled && row.flag === 'bad').length
}

/**
 * Agent → Tools & capabilities, shown in a Tools view tab. A rail picks the effect group; the pane
 * lists its tools as rows with inline overviews. The header carries the one number the switches
 * change: tokens per turn.
 */
export function ToolsPanel({ active: open, onSendToChat }: ToolsPanelProps): JSX.Element {
  const tools = useToolsController(open)
  const [openId, setOpenId] = useState<string | null>(null)
  const [groupId, setGroupId] = useState<ToolEffect>('reads-web')
  const now = useMemo(() => Date.now(), [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(
    () => tools.manifest ? groupTools(tools.manifest, tools.telemetry, now) : [],
    [tools.manifest, tools.telemetry, now]
  )
  const suggested = useMemo(() => suggestions(groups), [groups])
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0)
  const on = groups.reduce((sum, group) => sum + group.on, 0)
  const preset = tools.manifest ? detectPreset(tools.manifest) : 'custom'
  const totalCalls = tools.telemetry?.totalCalls ?? 0
  const maxGroupCost = useMemo(() => Math.max(1, ...groups.map((group) => group.costTokens)), [groups])
  const active = groups.find((group) => group.group.id === groupId) ?? groups[0] ?? null

  useEffect(() => {
    if (!open) return
    if (groups.length === 0) return
    if (!groups.some((group) => group.group.id === groupId)) setGroupId(groups[0]!.group.id)
  }, [open, groups, groupId])

  useEffect(() => {
    if (!open) {
      setOpenId(null)
    }
  }, [open])

  return (
      <div className="tools-panel">
        <header className="tools-panel-head shrink-0 border-b px-6 py-3.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Tools &amp; capabilities</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tools.manifest ? `${on} of ${total} on` : 'Loading…'}
            </p>
          </div>
          {tools.manifest ? (
            <p className="tools-panel-spend" aria-label={`About ${formatTokens(tools.manifest.advertisedTokens)} tokens of every turn`}>
              <b>{formatTokens(tools.manifest.advertisedTokens)}</b>
              <span>tokens / turn</span>
            </p>
          ) : null}
        </header>

        {tools.error && <p className="bg-destructive/15 px-6 py-2 text-[13px]" role="alert">{tools.error}</p>}

        {suggested.rows.length > 0 ? (
          <div className="flex shrink-0 items-center gap-3 border-b bg-muted/20 px-6 py-2.5 text-[13px] text-muted-foreground" role="status">
            <span className="min-w-0">
              <b className="font-medium text-foreground">{plural(suggested.rows.length, 'suggestion')}.</b>{' '}
              {suggested.rows.map((row) => row.tool.label).join(', ')} {suggested.rows.length === 1 ? 'has' : 'have'} not been used in weeks
              and cost{suggested.rows.length === 1 ? 's' : ''} {suggested.costTokens} tokens of every turn.
            </span>
            <Button variant="outline" size="sm" className="ml-auto shrink-0" data-ui="tools.suggestions-apply"
              onClick={() => void tools.setEnabledMany(suggested.rows.flatMap((row) => toolSwitches(row.tool, false)))}>
              Turn {suggested.rows.length === 1 ? 'it' : 'all'} off
            </Button>
          </div>
        ) : null}

        <div className="tools-panel-split min-h-0 flex-1">
          <nav className="tools-rail" aria-label="Effect groups">
            <div className="tools-rail-list" role="tablist">
              {groups.map((group) => {
                const selected = group.group.id === (active?.group.id ?? groupId)
                const fails = failingOn(group)
                return (
                  <button
                    key={group.group.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={cn('tools-rail-item', selected && 'tools-rail-item-active', RAIL_BAR[group.group.id])}
                    data-ui="tools.group-select"
                    data-ui-key={group.group.id}
                    onClick={() => { setGroupId(group.group.id); setOpenId(null) }}
                  >
                    <span className="tools-rail-title">{group.group.label}</span>
                    <span className="tools-rail-meta">{group.on}/{group.rows.length}</span>
                    <span className="tools-rail-sub">
                      {group.costTokens > 0 ? `${formatTokens(group.costTokens)} tokens` : 'off'}
                      {fails > 0 ? <span className="text-destructive"> · {plural(fails, 'failing')}</span> : null}
                    </span>
                    <span className="tools-rail-bar" aria-hidden="true">
                      <i style={{ width: `${Math.round((group.costTokens / maxGroupCost) * 100)}%` }} />
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="tools-rail-foot">
              <div className="tools-rail-slice">
                <div className="min-w-0">
                  <p className="tools-rail-slice-label" id="tools-task-slice-label">Task tool slices</p>
                  <p className="tools-rail-slice-note">Task-scoped eager tools and Cursor namespaces per turn</p>
                </div>
                <Switch
                  checked={tools.chatToolSliceEnabled}
                  disabled={!tools.manifest}
                  aria-labelledby="tools-task-slice-label"
                  data-ui="tools.task-slice"
                  onCheckedChange={(checked) => void tools.setChatToolSliceEnabled(checked)}
                />
              </div>
              <div className="settings-tabs" role="radiogroup" aria-label="Preset">
                {PRESETS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    className="settings-tab"
                    data-state={preset === entry.id ? 'active' : 'inactive'}
                    aria-checked={preset === entry.id}
                    disabled={entry.id === 'custom' || !tools.manifest}
                    data-ui="tools.preset"
                    data-ui-key={entry.id}
                    onClick={() => {
                      if (entry.id !== 'custom' && tools.manifest) void tools.setEnabledMany(presetSwitches(tools.manifest, entry.id))
                    }}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
          </nav>

          <div className="tools-pane min-w-0">
            {active ? (
              <>
                <div className="tools-pane-head">
                  <div className="min-w-0">
                    <h3 className="text-[13px] font-semibold">
                      {active.group.label}
                      <span className={cn('ml-2 text-xs font-normal', EFFECT_TEXT[active.group.id])}>{active.group.effect}</span>
                    </h3>
                    <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{active.group.summary}</p>
                  </div>
                  <Switch
                    checked={active.state !== 'off'}
                    className={cn('shrink-0', active.state === 'mixed' && 'data-[state=checked]:bg-primary/55')}
                    aria-label={`${active.state === 'off' ? 'Turn on' : 'Turn off'} ${active.group.label}`}
                    data-ui="tools.group-toggle"
                    data-ui-key={active.group.id}
                    onCheckedChange={() => void tools.setEnabledMany(groupSwitches(active))}
                  />
                </div>
                <div className="tools-pane-rows [scrollbar-width:thin]">
                  {active.rows.map((row) => (
                    <ToolRow
                      key={row.tool.id}
                      row={row}
                      effect={active.group.effect}
                      open={openId === row.tool.id}
                      now={now}
                      since={tools.telemetry?.since ?? null}
                      onOpenChange={(next) => setOpenId(next ? row.tool.id : null)}
                      onToggle={(enabled) => void tools.setEnabledMany(toolSwitches(row.tool, enabled))}
                      onRepair={() => onSendToChat(repairDraft(row, now))}
                    />
                  ))}
                </div>
              </>
            ) : (
              <p className="p-6 text-[13px] text-muted-foreground">{tools.manifest ? 'No tools are registered.' : 'Loading…'}</p>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-4 border-t px-6 py-2.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">
            Off takes effect now. Open chats pick up slice and enable changes on the next send or thread rotation.
          </span>
          <button type="button" className="whitespace-nowrap hover:enabled:text-foreground disabled:text-muted-foreground/50" disabled={totalCalls === 0} data-ui="tools.clear"
            onClick={() => void tools.clearTelemetry()}>
            Reset counts
          </button>
        </footer>
      </div>
  )
}
