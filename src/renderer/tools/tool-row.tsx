import { useState, type JSX } from 'react'

import { DisclosureRow } from '../../components/ui/disclosure-row.js'
import type { ToolInfo } from '../../shared/tools.js'
import { plural, relativeTime, unusedFor, type ToolRowModel } from './tools-model.js'

/** A three-state switch drawn the same for a row and for a group; groups can be mixed. */
export function ToolSwitch({
  state,
  label,
  control,
  item,
  onToggle
}: {
  state: 'on' | 'off' | 'mixed'
  label: string
  control: 'tools.toggle' | 'tools.group-toggle'
  item: string
  onToggle: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      className="tool-switch"
      data-state={state}
      aria-checked={state === 'mixed' ? 'mixed' : state === 'on'}
      aria-label={label}
      data-ui={control}
      data-ui-key={item}
      onClick={(event) => { event.stopPropagation(); onToggle() }}
    >
      <span className="tool-switch-thumb" aria-hidden="true" />
    </button>
  )
}

export type ToolRowProps = {
  row: ToolRowModel
  effect: string
  open: boolean
  now: number
  since: number | null
  onOpenChange: (open: boolean) => void
  onToggle: (enabled: boolean) => void
  /** Puts a repair request for this tool into the selected chat's composer. */
  onRepair: () => void
}

/** One line: name and switch. Click the name to drop down the tool's overview. */
export function ToolRow({ row, effect, open, now, since, onOpenChange, onToggle, onRepair }: ToolRowProps): JSX.Element {
  const { tool } = row
  return (
    <DisclosureRow
      id={tool.id}
      control="tools.row"
      label={tool.label}
      flag={row.flag}
      note={row.note}
      noteTone={row.flag}
      muted={!tool.enabled}
      open={open}
      onOpenChange={onOpenChange}
      trailing={
        <ToolSwitch
          state={tool.enabled ? 'on' : 'off'}
          label={`${tool.enabled ? 'Turn off' : 'Turn on'} ${tool.label}`}
          control="tools.toggle"
          item={tool.id}
          onToggle={() => onToggle(!tool.enabled)}
        />
      }
    >
      <ToolOverview row={row} effect={effect} now={now} since={since} onToggle={onToggle} onRepair={onRepair} />
    </DisclosureRow>
  )
}

function ToolOverview({ row, effect, now, since, onToggle, onRepair }: {
  row: ToolRowModel; effect: string; now: number; since: number | null; onToggle: (enabled: boolean) => void; onRepair: () => void
}): JSX.Element {
  const { tool, stat, errors } = row
  const [schemaOpen, setSchemaOpen] = useState(false)
  const verbs = tool.actions.map((action) => action.name).join(', ')
  return (
    <>
      <div className="disclosure-panel-id">
        {tool.id}{verbs ? <span> · {verbs}</span> : null}
      </div>
      <p className="disclosure-panel-text">
        {tool.summary ? `${tool.summary} ` : ''}
        <span>Off: {tool.offEffect}</span>
      </p>
      <dl className="disclosure-panel-facts">
        <dt>Effect</dt><dd>{effect}</dd>
        <dt>Cost</dt>
        <dd>
          {tool.enabled ? `${tool.costTokens} tokens of every turn` : `${tool.costTokens} tokens of every turn when on`}
          {tool.deferLoading ? ' · name only until the model loads it' : ''}
          {tool.actions.length > 0 ? ` · ${plural(tool.actions.length, 'verb')}` : ''}
          {tool.timeoutMs ? ` · ${Math.round(tool.timeoutMs / 1000)} s timeout` : ''}
        </dd>
        <dt>Last used</dt>
        <dd data-tone={row.suggestOff ? 'warn' : undefined}>
          {stat?.lastCalledAt ? relativeTime(stat.lastCalledAt, now) : since ? `never in ${unusedFor(null, since, now)} of counting` : 'never'}
          {row.suggestOff ? ` · suggested off: ${tool.costTokens} tokens of every turn for nothing` : ''}
        </dd>
        <dt>Runs</dt>
        <dd data-tone={row.flag === 'bad' ? 'bad' : undefined}>{usageLine(stat)}</dd>
      </dl>
      {errors.length > 0 ? (
        <ul className="tool-overview-errors" aria-label="Recent failures">
          {errors.map((note) => (
            <li key={`${note.at}-${note.kind}`} data-kind={note.kind}>
              <span className="tool-overview-error-meta">{relativeTime(note.at, now)} · {note.kind}{note.action ? ` · ${note.action}` : ''}</span>
              <span className="tool-overview-error-text">{note.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <blockquote className="disclosure-panel-quote">
        <span className="disclosure-panel-quote-label">What the model reads</span>
        {tool.description}
      </blockquote>
      <div className="disclosure-panel-actions">
        {row.suggestOff ? (
          <button type="button" className="disclosure-panel-action" data-ui="tools.suggest-off" data-ui-key={tool.id}
            onClick={() => onToggle(false)}>
            Turn off
          </button>
        ) : null}
        {errors.length > 0 ? (
          <button type="button" className="disclosure-panel-action" data-ui="tools.repair" data-ui-key={tool.id} onClick={onRepair}>
            Send to chat for repair
          </button>
        ) : null}
        <button type="button" className="disclosure-panel-action" data-ui="tools.schema" data-ui-key={tool.id}
          aria-expanded={schemaOpen} onClick={() => setSchemaOpen((value) => !value)}>
          {schemaOpen ? 'Hide schema' : 'Show schema'}
        </button>
      </div>
      {schemaOpen ? <ToolSchema tool={tool} /> : null}
    </>
  )
}

function usageLine(stat: ToolRowModel['stat']): string {
  if (!stat || stat.calls === 0) return 'No runs recorded'
  const parts = [plural(stat.calls, 'run')]
  const errors = stat.failures - stat.misuses
  if (errors > 0) parts.push(plural(errors, 'error'))
  if (stat.misuses > 0) parts.push(plural(stat.misuses, 'refused call'))
  if (stat.timeouts > 0) parts.push(plural(stat.timeouts, 'timeout'))
  return parts.join(' · ')
}

function ToolSchema({ tool }: { tool: ToolInfo }): JSX.Element {
  const sections = tool.actions.length > 0
    ? tool.actions.map((action) => ({ title: action.name, description: action.description, fields: action.fields }))
    : [{ title: null, description: '', fields: tool.fields }]
  return (
    <div className="tool-schema">
      {sections.map((section) => (
        <section key={section.title ?? tool.id} className="tool-schema-section">
          {section.title ? (
            <h4 className="tool-schema-title">{section.title}{section.description ? <span> · {section.description}</span> : null}</h4>
          ) : null}
          {section.fields.length === 0 ? <p className="tool-schema-empty">No arguments</p> : (
            <dl className="tool-schema-fields">
              {section.fields.map((field) => (
                <div key={field.name} className="tool-schema-field">
                  <dt><code>{field.name}</code><span>{field.required ? 'required' : field.type}</span></dt>
                  <dd>{field.description}{field.enum ? ` (${field.enum.join(' · ')})` : ''}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
    </div>
  )
}
