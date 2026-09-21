import { useState, type JSX } from 'react'
import { ChevronRight } from 'lucide-react'

import type { ToolInfo } from '../../shared/tools.js'
import { plural, type ToolRowModel } from './tools-model.js'

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
  onOpenChange: (open: boolean) => void
  onToggle: (enabled: boolean) => void
}

/** One line: name and switch. Click the name to drop down the tool's overview. */
export function ToolRow({ row, effect, open, onOpenChange, onToggle }: ToolRowProps): JSX.Element {
  const { tool } = row
  return (
    <li className="tool-row" data-enabled={tool.enabled} data-open={open}>
      <div className="tool-row-line">
        <button
          type="button"
          className="tool-row-open"
          aria-expanded={open}
          data-ui="tools.row"
          data-ui-key={tool.id}
          onClick={() => onOpenChange(!open)}
        >
          <ChevronRight size={13} className="tool-row-chevron" aria-hidden="true" />
          <span className="tool-row-name">{tool.label}</span>
          {row.flag ? <span className="tool-row-flag" data-tone={row.flag} aria-hidden="true" /> : null}
        </button>
        {row.note ? <span className="tool-row-note" data-tone={row.flag ?? undefined}>{row.note}</span> : null}
        <ToolSwitch
          state={tool.enabled ? 'on' : 'off'}
          label={`${tool.enabled ? 'Turn off' : 'Turn on'} ${tool.label}`}
          control="tools.toggle"
          item={tool.id}
          onToggle={() => onToggle(!tool.enabled)}
        />
      </div>
      {open ? <ToolOverview row={row} effect={effect} /> : null}
    </li>
  )
}

function ToolOverview({ row, effect }: { row: ToolRowModel; effect: string }): JSX.Element {
  const { tool, stat } = row
  const [schemaOpen, setSchemaOpen] = useState(false)
  const verbs = tool.actions.map((action) => action.name).join(', ')
  return (
    <div className="tool-overview">
      <div className="tool-overview-id">
        {tool.id}{verbs ? <span className="tool-overview-verbs"> · {verbs}</span> : null}
      </div>
      <p className="tool-overview-summary">
        {tool.summary ? `${tool.summary} ` : ''}
        <span className="tool-overview-off">Off: {tool.offEffect}</span>
      </p>
      <dl className="tool-overview-facts">
        <dt>Effect</dt><dd>{effect}</dd>
        <dt>Cost</dt>
        <dd>
          {tool.enabled ? `${tool.costTokens} tokens of every turn` : `${tool.costTokens} tokens of every turn when on`}
          {tool.deferLoading ? ' · name only until the model loads it' : ''}
          {tool.actions.length > 0 ? ` · ${plural(tool.actions.length, 'verb')}` : ''}
          {tool.timeoutMs ? ` · ${Math.round(tool.timeoutMs / 1000)} s timeout` : ''}
        </dd>
        <dt>Runs</dt>
        <dd data-tone={row.flag ?? undefined}>{usageLine(stat)}</dd>
      </dl>
      <blockquote className="tool-overview-model">
        <span className="tool-overview-model-label">What the model reads</span>
        {tool.description}
      </blockquote>
      <div className="tool-overview-actions">
        <button type="button" className="tool-overview-action" data-ui="tools.schema" data-ui-key={tool.id}
          aria-expanded={schemaOpen} onClick={() => setSchemaOpen((value) => !value)}>
          {schemaOpen ? 'Hide schema' : 'Show schema'}
        </button>
      </div>
      {schemaOpen ? <ToolSchema tool={tool} /> : null}
    </div>
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
