import type { JSX } from 'react'
import { useMemo, useState } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog.js'
import { ToolRow, ToolSwitch } from './tool-row.js'
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

/**
 * Agent → Tools & capabilities. Tools grouped by what they let the model do to the user, one
 * switch per group and per tool, and an overview that drops down under a clicked row. The
 * header carries the one number the switches change: what the enabled set costs every turn.
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
        <header className="tools-modal-header">
          <DialogTitle className="tools-modal-title">Tools &amp; capabilities</DialogTitle>
          <DialogDescription id="tools-modal-description" className="tools-modal-summary">
            {tools.manifest
              ? `${on} of ${total} on · about ${formatTokens(tools.manifest.advertisedTokens)} tokens of every turn`
              : 'Loading…'}
          </DialogDescription>
        </header>

        {tools.error && <p className="tools-modal-error" role="alert">{tools.error}</p>}

        <div className="tools-modal-list">
          {suggested.rows.length > 0 ? (
            <div className="tools-suggestions" role="status">
              <span>
                <b>{plural(suggested.rows.length, 'suggestion')}.</b>{' '}
                {suggested.rows.map((row) => row.tool.label).join(', ')} {suggested.rows.length === 1 ? 'has' : 'have'} not been used in weeks
                and cost{suggested.rows.length === 1 ? 's' : ''} {suggested.costTokens} tokens of every turn.
              </span>
              <button type="button" className="tools-suggestions-apply" data-ui="tools.suggestions-apply"
                onClick={() => void tools.setEnabledMany(suggested.rows.flatMap((row) => toolSwitches(row.tool, false)))}>
                Turn {suggested.rows.length === 1 ? 'it' : 'all'} off
              </button>
            </div>
          ) : null}
          {groups.map((group) => (
            <section key={group.group.id} className="tools-group" aria-labelledby={`tools-group-${group.group.id}`}>
              <div className="tools-group-head">
                <div className="tools-group-copy">
                  <h3 id={`tools-group-${group.group.id}`} className="tools-group-title">
                    {group.group.label}
                    <span className="tools-group-effect" data-effect={group.group.id}>{group.group.effect}</span>
                  </h3>
                  <p className="tools-group-summary">{group.group.summary}</p>
                </div>
                <span className="tools-group-cost">{group.state === 'off' ? 'off' : `${formatTokens(group.costTokens)} tokens / turn`}</span>
                <ToolSwitch
                  state={group.state}
                  label={`${group.state === 'off' ? 'Turn on' : 'Turn off'} ${group.group.label}`}
                  control="tools.group-toggle"
                  item={group.group.id}
                  onToggle={() => void tools.setEnabledMany(groupSwitches(group))}
                />
              </div>
              <ul className="tools-group-rows">
                {group.rows.map((row) => (
                  <ToolRow
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
              </ul>
            </section>
          ))}
          {tools.manifest && groups.length === 0 && <p className="tools-modal-empty">No tools are registered.</p>}
        </div>

        <footer className="tools-modal-footer">
          <div className="tools-presets" role="radiogroup" aria-label="Preset">
            {PRESETS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                className="tools-preset"
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
          <span className="tools-modal-note">Off takes effect now. Open chats keep their list until their next thread.</span>
          <button type="button" className="tools-modal-link" disabled={totalCalls === 0} data-ui="tools.clear"
            onClick={() => void tools.clearTelemetry()}>
            Reset counts
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
