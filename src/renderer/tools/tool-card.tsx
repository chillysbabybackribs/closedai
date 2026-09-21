import { useState, type JSX } from 'react'
import { ChevronDown } from 'lucide-react'

import { Button } from '../../components/ui/button.js'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card.js'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible.js'
import { Switch } from '../../components/ui/switch.js'
import { cn } from '../../lib/utils.js'
import type { ToolInfo } from '../../shared/tools.js'
import { plural, relativeTime, unusedFor, type ToolRowModel } from './tools-model.js'

const TONE_TEXT = {
  bad: 'text-destructive',
  warn: 'text-[color:var(--warning,#c58b45)]'
} as const

export type ToolCardProps = {
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

/**
 * One tool as a card: name and switch in the header, the person-facing summary beneath, one
 * status line, and a Details disclosure that opens the full overview. An open card takes the
 * whole grid row so the overview has room to read.
 */
export function ToolCard({ row, effect, open, now, since, onOpenChange, onToggle, onRepair }: ToolCardProps): JSX.Element {
  const { tool } = row
  return (
    <Card
      data-enabled={tool.enabled}
      data-tool={tool.id}
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'gap-3 py-4 transition-[opacity,box-shadow]',
        open && 'col-span-full ring-1 ring-ring/40',
        !tool.enabled && 'opacity-60'
      )}
    >
      <CardHeader className="gap-1 px-4">
        <CardTitle className="flex items-center gap-2 text-[13.5px]">
          <span className="truncate">{tool.label}</span>
          {row.flag ? <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', row.flag === 'bad' ? 'bg-destructive' : 'bg-[color:var(--warning,#c58b45)]')} /> : null}
        </CardTitle>
        <CardDescription className="text-xs leading-relaxed">{tool.summary || tool.offEffect}</CardDescription>
        <CardAction>
          <Switch
            checked={tool.enabled}
            onCheckedChange={onToggle}
            aria-label={`${tool.enabled ? 'Turn off' : 'Turn on'} ${tool.label}`}
            data-ui="tools.toggle"
            data-ui-key={tool.id}
          />
        </CardAction>
      </CardHeader>
      <Collapsible open={open} onOpenChange={onOpenChange} className="contents">
        <CardFooter className="mt-auto items-center justify-between gap-3 px-4">
          <span className={cn('truncate text-xs text-muted-foreground', row.flag && TONE_TEXT[row.flag])}>
            {row.note || `${tool.costTokens} tokens / turn`}
          </span>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground" data-ui="tools.row" data-ui-key={tool.id}>
              Details
              <ChevronDown className={cn('transition-transform', open && 'rotate-180')} aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
        </CardFooter>
        <CollapsibleContent>
          <CardContent className="border-t px-4 pt-4">
            <ToolDetails row={row} effect={effect} now={now} since={since} onToggle={onToggle} onRepair={onRepair} />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
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
    ['Runs', usageLine(stat), row.flag === 'bad' ? 'bad' : null]
  ]
  return (
    <div className="grid gap-4 text-[13px] md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        <div className="font-mono text-xs text-muted-foreground">
          {tool.id}{verbs ? <span className="text-muted-foreground/60"> · {verbs}</span> : null}
        </div>
        <p className="mt-2 leading-relaxed">
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
      <blockquote className="max-h-56 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
        <span className="mb-1 block text-[10.5px] tracking-wider text-muted-foreground/70 uppercase">What the model reads</span>
        {tool.description}
      </blockquote>
      {schemaOpen ? <div className="md:col-span-2"><ToolSchema tool={tool} /></div> : null}
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
