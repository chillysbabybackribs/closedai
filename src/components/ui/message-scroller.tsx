import {
  forwardRef,
  useMemo,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type JSX,
  type KeyboardEvent,
  type Ref
} from 'react'
import { ArrowDownIcon } from 'lucide-react'

import { cn } from '../../lib/utils.js'
import { Button } from './button.js'
import {
  MessageScrollerProvider,
  useScrollerContext,
  type ScrollerContextValue,
  type ScrollPosition
} from './message-scroller-context.js'
import type { ScrollEdges } from './message-scroller-state.js'

const MessageScroller = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function MessageScroller({ className, ...props }, ref) {
    const { state } = useScrollerContext()
    const scrollable = [state.edges.start && 'start', state.edges.end && 'end'].filter(Boolean).join(' ')
    return (
      <div
        ref={ref}
        data-slot="message-scroller"
        data-scroll-dir={state.direction}
        data-scrollable={scrollable || undefined}
        className={cn('group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden', className)}
        {...props}
      />
    )
  }
)

const MessageScrollerViewport = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function MessageScrollerViewport({ className, onKeyDown, onScroll, onTouchMove, onWheel, ...props }, ref) {
    const { setViewport, state, syncFromViewport, userScrollIntent } = useScrollerContext()
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
      const direction = userScrollDirection(event)
      if (direction) userScrollIntent(direction)
      onKeyDown?.(event)
    }
    return (
      <div
        ref={mergeRefs(ref, setViewport)}
        role="region"
        aria-label="Messages"
        tabIndex={0}
        data-slot="message-scroller-viewport"
        data-pending-scroll={state.pending ? '' : undefined}
        className={cn('size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain data-pending-scroll:invisible', className)}
        onKeyDown={handleKeyDown}
        onScroll={(event) => { syncFromViewport(); onScroll?.(event) }}
        onTouchMove={(event) => { userScrollIntent(); onTouchMove?.(event) }}
        onWheel={(event) => {
          if (event.deltaY !== 0) userScrollIntent(event.deltaY < 0 ? 'start' : 'end')
          onWheel?.(event)
        }}
        {...props}
      />
    )
  }
)

const MessageScrollerContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function MessageScrollerContent({ className, ...props }, ref) {
    const { setContent, setSpacer } = useScrollerContext()
    return (
      <div
        ref={mergeRefs(ref, setContent)}
        role="log"
        aria-relevant="additions"
        data-slot="message-scroller-content"
        className={cn('flex h-max min-h-full flex-col gap-8', className)}
        {...props}
      >
        {props.children}
        <div ref={setSpacer} data-message-scroller-spacer="" aria-hidden="true" className="shrink-0" hidden />
      </div>
    )
  }
)

type ItemProps = HTMLAttributes<HTMLDivElement> & {
  messageId?: string
  scrollAnchor?: boolean
}

const MessageScrollerItem = forwardRef<HTMLDivElement, ItemProps>(
  function MessageScrollerItem({ className, messageId, scrollAnchor = false, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="message-scroller-item"
        data-message-id={messageId}
        data-scroll-anchor={scrollAnchor ? 'true' : undefined}
        className={cn('min-w-0 shrink-0', className)}
        {...props}
      />
    )
  }
)

type ScrollerButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  direction?: Exclude<ScrollPosition, 'last-anchor'>
}

function MessageScrollerButton({
  direction = 'end',
  className,
  children,
  onClick,
  tabIndex,
  ...props
}: ScrollerButtonProps): JSX.Element {
  const { scrollToEnd, scrollToStart, state } = useScrollerContext()
  const active = direction === 'start' ? state.edges.start : state.edges.end
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon-sm"
      inert={!active}
      tabIndex={active ? tabIndex : -1}
      data-slot="message-scroller-button"
      data-direction={direction}
      data-active={String(active)}
      className={cn(
        'absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180',
        className
      )}
      aria-label={direction === 'end' ? 'Scroll to latest message' : 'Scroll to first loaded message'}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        if (direction === 'end') scrollToEnd()
        else scrollToStart()
      }}
      {...props}
    >
      {children ?? <ArrowDownIcon />}
    </Button>
  )
}

function useMessageScroller(): Pick<ScrollerContextValue, 'prepareForPrepend' | 'scrollToEnd' | 'scrollToStart'> {
  const { prepareForPrepend, scrollToEnd, scrollToStart } = useScrollerContext()
  return useMemo(
    () => ({ prepareForPrepend, scrollToEnd, scrollToStart }),
    [prepareForPrepend, scrollToEnd, scrollToStart]
  )
}

function useMessageScrollerScrollable(): ScrollEdges {
  return useScrollerContext().state.edges
}

function userScrollDirection(event: KeyboardEvent): 'start' | 'end' | null {
  if (event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'PageUp' ||
      (event.key === ' ' && event.shiftKey)) return 'start'
  if (event.key === 'ArrowDown' || event.key === 'End' || event.key === 'PageDown' ||
      (event.key === ' ' && !event.shiftKey)) return 'end'
  return null
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): (value: T | null) => void {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(value)
      else if (ref) ref.current = value
    }
  }
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable
}
