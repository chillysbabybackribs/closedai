import type { HTMLAttributes, ReactNode } from 'react'
import { createContext, useContext, useState } from 'react'

import { cn } from '../../lib/utils.js'
import { Markdown } from './markdown.js'

type ReasoningContextValue = { isOpen: boolean; onOpenChange: (open: boolean) => void }
const ReasoningContext = createContext<ReasoningContextValue | null>(null)

function useReasoning(): ReasoningContextValue {
  const context = useContext(ReasoningContext)
  if (!context) throw new Error('Reasoning components must be nested inside Reasoning')
  return context
}

export type ReasoningProps = HTMLAttributes<HTMLDivElement> & {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function Reasoning({ children, className, open, onOpenChange, ...props }: ReasoningProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const controlled = open !== undefined
  const isOpen = controlled ? open : internalOpen

  const changeOpen = (next: boolean): void => {
    if (!controlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <ReasoningContext.Provider value={{ isOpen, onOpenChange: changeOpen }}>
      <div data-slot="reasoning" className={className} {...props}>{children}</div>
    </ReasoningContext.Provider>
  )
}

function ReasoningTrigger({ children, className, ...props }: HTMLAttributes<HTMLButtonElement>) {
  const { isOpen, onOpenChange } = useReasoning()
  return (
    <button
      type="button"
      data-slot="reasoning-trigger"
      aria-expanded={isOpen}
      className={cn('flex cursor-pointer items-center', className)}
      onClick={() => onOpenChange(!isOpen)}
      {...props}
    >
      {children}
    </button>
  )
}

export type ReasoningContentProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  markdown?: boolean
  contentClassName?: string
}

function ReasoningContent({ children, markdown = false, className, contentClassName, ...props }: ReasoningContentProps) {
  const { isOpen } = useReasoning()
  if (!isOpen) return null
  return (
    <div data-slot="reasoning-content" className={className} {...props}>
      {markdown
        ? <Markdown className={contentClassName}>{String(children)}</Markdown>
        : <div className={contentClassName}>{children}</div>}
    </div>
  )
}

export { Reasoning, ReasoningContent, ReasoningTrigger }
