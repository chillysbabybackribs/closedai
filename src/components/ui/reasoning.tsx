import type { HTMLAttributes, ReactNode } from 'react'
import { createContext, useContext, useEffect, useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'

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
  isStreaming?: boolean
}

function Reasoning({ children, className, open, onOpenChange, isStreaming, ...props }: ReasoningProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [autoOpened, setAutoOpened] = useState(false)
  const controlled = open !== undefined
  const isOpen = controlled ? open : internalOpen

  useEffect(() => {
    if (isStreaming && !autoOpened) {
      if (!controlled) setInternalOpen(true)
      setAutoOpened(true)
    } else if (!isStreaming && autoOpened) {
      if (!controlled) setInternalOpen(false)
      setAutoOpened(false)
    }
  }, [autoOpened, controlled, isStreaming])

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
      className={cn('flex cursor-pointer items-center gap-2', className)}
      onClick={() => onOpenChange(!isOpen)}
      {...props}
    >
      <span>{children}</span>
      <ChevronDownIcon className={cn('size-4 transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
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
