import { useState, type JSX } from 'react'

import { Button } from '../../components/ui/button.js'
import { Collapsible, CollapsibleContent } from '../../components/ui/collapsible.js'
import { Switch } from '../../components/ui/switch.js'
import { cn } from '../../lib/utils.js'
import type { ToolInfo } from '../../shared/tools.js'
import { formatTokens, plural, relativeTime, unusedFor, type ToolRowModel } from './tools-model.js'

const TONE_TEXT = {
  bad: 'text-destructive',
  warn: 'text-[color:var(--warning,#c58b45)]'
} as const

export type ToolRowProps = {
  row: ToolRowModel
  effect: string
  open: boolean
  now: number
  since: number | null
  onOpenChange: (open: boolean) => void
  onToggle: (enabled: boolean) => void
  onRepair: () => void
}

/** One tool as a ledger row: switch, name, summary, cost, status dot; click opens the overview inline. */
export function ToolRow({ row, effect, open, now, since, onOpenChange, onToggle, onRepair }: ToolRowProps): JSX.Element {
  const { tool } = row
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="tools-tool-row">
      <div
        role="button"
        tabIndex={0}
        data-enabled={tool.enabled}
        data-tool={tool.id}
        data-state={open ? 'open' : 'closed'}
        data-ui="tools.row"
        data-ui-key={tool.id}
        className={cn('tools-row', open && 'tools-row-open', !tool.enabled && 'tools-row-off')}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpenChange(!open)
          }
        }}
      >
        <Switch
          checked={tool.enabled}
          onCheckedChange={onToggle}
          aria-label={`${tool.enabled ? 'Turn off' : 'Turn on'} ${tool.label}`}
          data-ui="tools.toggle"
          data-ui-key={tool.id}
          onClick={(event) => event.stopPropagation()}
        />
        <span className="tools-row-name">{tool.label}</span>
        <span className="tools-row-summary">{tool.summary || tool.offEffect}</span>
        <span className="tools-row-cost">{tool.enabled ? formatTokens(tool.costTokens) : '—'}</span>
        <span
          aria-hidden={!row.flag}
          className={cn('tools-row-dot', row.flag === 'bad' && 'tools-row-dot-bad', row.flag === 'warn' && 'tools-row-dot-warn')}
          title={row.note || undefined}
        />
      </div>
      <CollapsibleContent className="tools-row-detail">
        <ToolDetails row={row} effect={effect} now={now} since={since} onToggle={onToggle} onRepair={onRepair} />
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolDetails({ row, effect, now, since, onToggle, onRepair }: {
  row: ToolRowModel; effect: string; now: number; since: number | null; onToggle: (enabled: boolean) => void; onRepair: () => void
}): JSX.Element {
  const { tool, stat, errors } = row
  const [schemaOpen, setSchemaOpen] = useState(false)
  const verbs = tool.actions.map((action) => action.name).join(', ')
  const facts: Array<[string, string, 'bad' | 'warn' | null]> = [
    ['Effect', effect, null],
    ['Cost', [
      `${tool.costTokens} tokens of every turn${tool.enabled ? '' : ' when on'}`,
      tool.deferLoading ? 'name only until the model loads it' : '',
      tool.actions.length > 0 ? plural(tool.actions.length, 'verb') : '',
      tool.timeoutMs ? `${Math.round(tool.timeoutMs / 1000)} s timeout` : ''
    ].filter(Boolean).join(' · '), null],
    ['Last used', (stat?.lastCalledAt ? relativeTime(stat.lastCalledAt, now) : since ? `never in ${unusedFor(null, since, now)} of counting` : 'never')
      + (row.suggestOff ? ` · suggested off: ${tool.costTokens} tokens of every turn for nothing` : ''), row.suggestOff ? 'warn' : null],
    ['Runs', usageLine(stat, row), row.flag === 'bad' ? 'bad' : null]
  ]
  return (
    <div className="tools-detail-grid">
      <div className="min-w-0">
        <div className="font-mono text-xs text-muted-foreground">
          {tool.id}{verbs ? <span className="text-muted-foreground/60"> · {verbs}</span> : null}
        </div>
        <p className="mt-2 text-[13px] leading-relaxed">
          {tool.summary ? `${tool.summary} ` : ''}
          <span className="text-muted-foreground">Off: {tool.offEffect}</span>
        </p>
        <dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          {facts.map(([term, value, tone]) => (
            <div key={term} className="contents">
              <dt className="text-muted-foreground/70">{term}</dt>
              <dd className={cn('text-muted-foreground', tone && TONE_TEXT[tone])}>{value}</dd>
            </div>
          ))}
        </dl>
        {errors.length > 0 ? (
          <ul className="mt-3 grid gap-1 text-xs" aria-label="Recent failures">
            {errors.map((note) => (
              <li key={`${note.at}-${note.kind}`} className="grid grid-cols-[max-content_minmax(0,1fr)] gap-3">
                <span className="whitespace-nowrap text-muted-foreground/70 tabular-nums">{relativeTime(note.at, now)} · {note.kind}{note.action ? ` · ${note.action}` : ''}</span>
                <span className={cn('break-words', note.kind === 'error' ? TONE_TEXT.bad : TONE_TEXT.warn)}>{note.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {row.suggestOff ? (
            <Button variant="outline" size="sm" data-ui="tools.suggest-off" data-ui-key={tool.id} onClick={() => onToggle(false)}>Turn off</Button>
          ) : null}
          {errors.length > 0 ? (
            <Button variant="outline" size="sm" data-ui="tools.repair" data-ui-key={tool.id} onClick={onRepair}>Send to chat for repair</Button>
          ) : null}
          <Button variant="outline" size="sm" data-ui="tools.schema" data-ui-key={tool.id} aria-expanded={schemaOpen} onClick={() => setSchemaOpen((value) => !value)}>
            {schemaOpen ? 'Hide schema' : 'Show schema'}
          </Button>
        </div>
      </div>
      <blockquote className="tools-detail-model max-h-56 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
        <span className="mb-1 block text-[10.5px] tracking-wider text-muted-foreground/70 uppercase">What the model reads</span>
        {tool.description}
      </blockquote>
      {schemaOpen ? <div className="tools-detail-schema"><ToolSchema tool={tool} /></div> : null}
    </div>
  )
}

function usageLine(stat: ToolRowModel['stat'], row: ToolRowModel): string {
  if (row.note && row.flag === 'bad') return row.note
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
    <div className="grid gap-3 rounded-md border p-3 text-xs">
      {sections.map((section) => (
        <section key={section.title ?? tool.id}>
          {section.title ? (
            <h4 className="mb-1 font-mono font-semibold">{section.title}{section.description ? <span className="ml-2 font-sans font-normal text-muted-foreground">{section.description}</span> : null}</h4>
          ) : null}
          {section.fields.length === 0 ? <p className="text-muted-foreground/70">No arguments</p> : (
            <dl className="grid gap-1">
              {section.fields.map((field) => (
                <div key={field.name} className="grid grid-cols-[200px_minmax(0,1fr)] gap-3">
                  <dt className="flex items-baseline gap-2"><code className="font-mono">{field.name}</code><span className="text-[11px] text-muted-foreground/70">{field.required ? 'required' : field.type}</span></dt>
                  <dd className="text-muted-foreground">{field.description}{field.enum ? ` (${field.enum.join(' · ')})` : ''}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
    </div>
  )
}
