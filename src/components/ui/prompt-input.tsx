import type { KeyboardEvent, MouseEventHandler, ReactNode } from 'react'
import { createContext, createRef, useContext, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '../../lib/utils.js'
import { Textarea } from './textarea.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.js'

type PromptInputContextValue = {
  value: string
  setValue: (value: string) => void
  maxHeight: number | string
  onSubmit?: () => void
  disabled: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

const PromptInputContext = createContext<PromptInputContextValue>({
  value: '',
  setValue: () => undefined,
  maxHeight: 240,
  disabled: false,
  textareaRef: createRef<HTMLTextAreaElement>()
})

function usePromptInput(): PromptInputContextValue {
  return useContext(PromptInputContext)
}

export type PromptInputProps = React.ComponentProps<'div'> & {
  isLoading?: boolean
  value?: string
  onValueChange?: (value: string) => void
  maxHeight?: number | string
  onSubmit?: () => void
  children: ReactNode
  disabled?: boolean
}

function PromptInput({
  className,
  isLoading = false,
  maxHeight = 240,
  value,
  onValueChange,
  onSubmit,
  children,
  disabled = false,
  onClick,
  ...props
}: PromptInputProps) {
  const [internalValue, setInternalValue] = useState(value ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const setValue = onValueChange ?? setInternalValue
  const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    // Clicking the box focuses the textarea, but not when the click landed on a control inside
    // it: a menu opened by that control's pointerdown would be dismissed by the focus change.
    const control = (event.target as HTMLElement | null)?.closest('button, a, input, select, [role="menu"], [role="menuitem"]')
    if (!disabled && !control) textareaRef.current?.focus()
    onClick?.(event)
  }

  return (
    <TooltipProvider>
      <PromptInputContext.Provider value={{ value: value ?? internalValue, setValue, maxHeight, onSubmit, disabled, textareaRef }}>
        <div
          data-slot="prompt-input"
          data-loading={isLoading || undefined}
          onClick={handleClick}
          className={cn(
            'border-input bg-background cursor-text rounded-3xl border p-2 shadow-xs',
            disabled && 'cursor-not-allowed opacity-60',
            className
          )}
          {...props}
        >
          {children}
        </div>
      </PromptInputContext.Provider>
    </TooltipProvider>
  )
}

export type PromptInputTextareaProps = React.ComponentProps<typeof Textarea> & { disableAutosize?: boolean }

function PromptInputTextarea({ className, onKeyDown, disableAutosize = false, ...props }: PromptInputTextareaProps) {
  const { value, setValue, maxHeight, onSubmit, disabled, textareaRef } = usePromptInput()

  function adjustHeight(element: HTMLTextAreaElement | null): void {
    if (!element || disableAutosize) return
    element.style.height = 'auto'
    element.style.height = typeof maxHeight === 'number'
      ? `${Math.min(element.scrollHeight, maxHeight)}px`
      : `min(${element.scrollHeight}px, ${maxHeight})`
  }

  useLayoutEffect(() => adjustHeight(textareaRef.current), [value, maxHeight, disableAutosize, textareaRef])

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSubmit?.()
    }
    onKeyDown?.(event)
  }

  return (
    <Textarea
      // An inline ref callback is a new function every render, so React detached and reattached
      // it — and re-measured the textarea — on renders that had nothing to do with its text.
      // The layout effect below already sizes it on mount and whenever the value changes.
      ref={textareaRef}
      value={value}
      onChange={(event) => {
        adjustHeight(event.target)
        setValue(event.target.value)
      }}
      onKeyDown={handleKeyDown}
      className={cn(
        'text-primary min-h-11 w-full resize-none border-none bg-transparent shadow-none outline-none focus-visible:ring-0',
        className
      )}
      rows={1}
      disabled={disabled}
      {...props}
    />
  )
}

function PromptInputActions({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="prompt-input-actions" className={cn('flex items-center gap-2', className)} {...props} />
}

export type PromptInputActionProps = React.ComponentProps<typeof Tooltip> & {
  className?: string
  tooltip: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

function PromptInputAction({ tooltip, children, className, side = 'top', ...props }: PromptInputActionProps) {
  const { disabled } = usePromptInput()
  return (
    <Tooltip {...props}>
      <TooltipTrigger asChild disabled={disabled} onClick={(event) => event.stopPropagation()}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className={className}>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export { PromptInput, PromptInputAction, PromptInputActions, PromptInputTextarea }
