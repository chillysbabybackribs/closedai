import type { JSX } from 'react'
import { useMemo, useState } from 'react'

import { Button } from '../../components/ui/button.js'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog.js'
import { Switch } from '../../components/ui/switch.js'
import { cn } from '../../lib/utils.js'
import type { ToolEffect } from '../../shared/tools.js'
import { ToolCard } from './tool-card.js'
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
  type ToolPreset
} from './tools-model.js'

export type ToolsModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Hands the selected chat a repair request for a tool; the pane owns its composer. */
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

/**
 * Agent → Tools & capabilities. One section per effect group with a master switch, a card per
 * tool inside it, and the one number the switches change in the header: what the enabled set
 * costs every turn.
 */
export function ToolsModal({ open, onOpenChange, onSendToChat }: ToolsModalProps): JSX.Element {
  const tools = useToolsController(open)
  const [openId, setOpenId] = useState<string | null>(null)
  // One clock per open so every "ago" in the dialog agrees; the dialog is short-lived.
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tools-modal" aria-describedby="tools-modal-description" data-ui="dialog.tools">
        <header className="shrink-0 border-b px-7 py-4 pr-14">
          <DialogTitle className="text-base font-semibold">Tools &amp; capabilities</DialogTitle>
          <DialogDescription id="tools-modal-description" className="mt-1 text-[13px] text-muted-foreground">
            {tools.manifest
              ? `${on} of ${total} on · about ${formatTokens(tools.manifest.advertisedTokens)} tokens of every turn`
              : 'Loading…'}
          </DialogDescription>
        </header>

        {tools.error && <p className="bg-destructive/15 px-7 py-2 text-[13px]" role="alert">{tools.error}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5 [scrollbar-width:thin]">
          {suggested.rows.length > 0 ? (
            <div className="mb-5 flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-[13px] text-muted-foreground" role="status">
              <span>
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

          <div className="grid gap-7">
            {groups.map((group) => (
              <section key={group.group.id} aria-labelledby={`tools-group-${group.group.id}`}>
                <div className="mb-3 flex items-end justify-between gap-6">
                  <div className="min-w-0">
                    <h3 id={`tools-group-${group.group.id}`} className="text-[15px] font-semibold">
                      {group.group.label}
                      <span className={cn('ml-2.5 text-xs font-normal', EFFECT_TEXT[group.group.id])}>{group.group.effect}</span>
                    </h3>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{group.group.summary}</p>
                  </div>
                  <label className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
                    <span>{group.state === 'off' ? `0 of ${group.rows.length} on` : `${group.on} of ${group.rows.length} on · ${formatTokens(group.costTokens)} tokens / turn`}</span>
                    <Switch
                      checked={group.state !== 'off'}
                      className={cn(group.state === 'mixed' && 'data-[state=checked]:bg-primary/55')}
                      aria-label={`${group.state === 'off' ? 'Turn on' : 'Turn off'} ${group.group.label}`}
                      data-ui="tools.group-toggle"
                      data-ui-key={group.group.id}
                      onCheckedChange={() => void tools.setEnabledMany(groupSwitches(group))}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
                  {group.rows.map((row) => (
                    <ToolCard
                      key={row.tool.id}
                      row={row}
                      effect={group.group.effect}
                      open={openId === row.tool.id}
                      now={now}
                      since={tools.telemetry?.since ?? null}
                      onOpenChange={(next) => setOpenId(next ? row.tool.id : null)}
                      onToggle={(enabled) => void tools.setEnabledMany(toolSwitches(row.tool, enabled))}
                      onRepair={() => onSendToChat(repairDraft(row, now))}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
          {tools.manifest && groups.length === 0 && <p className="text-[13px] text-muted-foreground">No tools are registered.</p>}
        </div>

        <footer className="flex shrink-0 items-center gap-4 border-t px-7 py-3 text-xs text-muted-foreground">
          <div className="flex gap-3" role="radiogroup" aria-label="Preset">
            {PRESETS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                className={cn('text-xs hover:enabled:text-foreground disabled:cursor-default', preset === entry.id && 'font-semibold text-foreground')}
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
          <span className="min-w-0 flex-1">Off takes effect now. Open chats keep their list until their next thread.</span>
          <button type="button" className="whitespace-nowrap hover:enabled:text-foreground disabled:text-muted-foreground/50" disabled={totalCalls === 0} data-ui="tools.clear"
            onClick={() => void tools.clearTelemetry()}>
            Reset counts
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
