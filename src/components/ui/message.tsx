import type { HTMLProps, ReactNode } from 'react'

import { cn } from '../../lib/utils.js'
import { Markdown } from './markdown.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.js'

function Message({ children, className, ...props }: HTMLProps<HTMLDivElement> & { children: ReactNode }) {
  return <div data-slot="message" className={cn('flex gap-3', className)} {...props}>{children}</div>
}

export type MessageContentProps = Omit<HTMLProps<HTMLDivElement>, 'children'> & {
  children: ReactNode
  markdown?: boolean
}

function MessageContent({ children, markdown = false, className, ...props }: MessageContentProps) {
  const classes = cn('rounded-lg p-2 text-foreground bg-secondary break-words whitespace-normal', className)
  return markdown
    ? <Markdown className={classes} {...props}>{String(children)}</Markdown>
    : <div data-slot="message-content" className={classes} {...props}>{children}</div>
}

function MessageActions({ className, ...props }: HTMLProps<HTMLDivElement>) {
  return <div data-slot="message-actions" className={cn('text-muted-foreground flex items-center gap-2', className)} {...props} />
}

export type MessageActionProps = React.ComponentProps<typeof Tooltip> & {
  className?: string
  tooltip: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

function MessageAction({ tooltip, children, className, side = 'top', ...props }: MessageActionProps) {
  return (
    <TooltipProvider>
      <Tooltip {...props}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className={className}>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { Message, MessageAction, MessageActions, MessageContent }
