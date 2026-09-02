import { useState } from 'react'
import { CheckCircle2, CircleEllipsis, Loader2, XCircle } from 'lucide-react'

import { cn } from '../../lib/utils.js'
import { Button } from './button.js'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible.js'

export type ToolPart = {
  type: string
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  toolCallId?: string
  errorText?: string
}

export type ToolProps = {
  toolPart: ToolPart
  defaultOpen?: boolean
  className?: string
}

function Tool({ toolPart, defaultOpen = false, className }: ToolProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const hasDetails = Boolean(toolPart.input || toolPart.output || toolPart.errorText)
  const status = toolStatus(toolPart.state)

  return (
    <div data-slot="tool" className={cn('prompt-tool overflow-hidden', className)}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild disabled={!hasDetails}>
          <Button variant="ghost" className="prompt-tool-trigger h-auto w-full justify-start rounded-none px-3 py-2 font-normal">
            <span className="prompt-tool-title">
              <status.Icon className={cn('size-4', status.spin && 'animate-spin')} aria-hidden="true" />
              <span>{toolPart.type}</span>
              <em>{status.label}</em>
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="prompt-tool-content">
          {toolPart.input && <ToolSection label="Input" value={toolPart.input} />}
          {toolPart.output && <ToolSection label="Output" value={toolPart.output} />}
          {toolPart.errorText && <ToolSection label="Error" value={toolPart.errorText} tone="error" />}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function ToolSection({ label, value, tone }: { label: string; value: unknown; tone?: 'error' }) {
  return (
    <section className="prompt-tool-section" data-tone={tone}>
      <strong>{label}</strong>
      <pre>{formatValue(value)}</pre>
    </section>
  )
}

function toolStatus(state: ToolPart['state']): { Icon: typeof CircleEllipsis; label: string; spin?: boolean } {
  switch (state) {
    case 'input-streaming': return { Icon: Loader2, label: 'Running', spin: true }
    case 'input-available': return { Icon: CircleEllipsis, label: 'Waiting' }
    case 'output-error': return { Icon: XCircle, label: 'Failed' }
    case 'output-available': return { Icon: CheckCircle2, label: 'Completed' }
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export { Tool }
