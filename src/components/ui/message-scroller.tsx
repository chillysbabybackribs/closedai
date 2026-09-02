import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type Ref
} from 'react'
import { ArrowDownIcon } from 'lucide-react'

import { cn } from '../../lib/utils.js'
import { Button } from './button.js'
import { scrollEdges, type ScrollEdges, type ScrollMetrics } from './message-scroller-state.js'

const EDGE_THRESHOLD = 24

type ScrollDirection = 'up' | 'down'
type ScrollPosition = 'start' | 'end'

type ScrollerState = {
  direction: ScrollDirection
  edges: ScrollEdges
  pending: boolean
}

type PrependSnapshot = {
  scrollHeight: number
  scrollTop: number
}

type ScrollerContextValue = {
  content: HTMLDivElement | null
  prepareForPrepend: () => void
  scrollToEnd: (behavior?: ScrollBehavior) => void
  scrollToStart: (behavior?: ScrollBehavior) => void
  setContent: (element: HTMLDivElement | null) => void
  setViewport: (element: HTMLDivElement | null) => void
  state: ScrollerState
  syncFromViewport: () => void
  userScrollIntent: () => void
  viewport: HTMLDivElement | null
}

const ScrollerContext = createContext<ScrollerContextValue | null>(null)

function useScrollerContext(): ScrollerContextValue {
  const value = useContext(ScrollerContext)
  if (!value) throw new Error('MessageScroller components must be inside MessageScrollerProvider')
  return value
}

type ProviderProps = {
  autoScroll?: boolean
  children: ReactNode
  defaultScrollPosition?: ScrollPosition
}

function MessageScrollerProvider({
  autoScroll = false,
  children,
  defaultScrollPosition = 'end'
}: ProviderProps): JSX.Element {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const [state, setState] = useState<ScrollerState>({
    direction: 'down',
    edges: { start: false, end: false },
    pending: true
  })
  const followingRef = useRef(autoScroll && defaultScrollPosition === 'end')
  const lastScrollTopRef = useRef(0)
  const prependRef = useRef<PrependSnapshot | null>(null)
  const frameRef = useRef<number | null>(null)

  const syncFromViewport = useCallback(() => {
    if (!viewport) return
    const metrics = viewportMetrics(viewport)
    const direction = metrics.scrollTop < lastScrollTopRef.current ? 'up' : 'down'
    lastScrollTopRef.current = metrics.scrollTop
    const edges = scrollEdges(metrics, EDGE_THRESHOLD)
    if (!edges.end) followingRef.current = autoScroll
    setState((previous) => (
      previous.direction === direction &&
      previous.edges.start === edges.start &&
      previous.edges.end === edges.end &&
      !previous.pending
        ? previous
        : { direction, edges, pending: false }
    ))
  }, [autoScroll, viewport])

  const scheduleSync = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      syncFromViewport()
    })
  }, [syncFromViewport])

  const scrollToStart = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!viewport) return
    followingRef.current = false
    viewport.scrollTo({ top: 0, behavior })
    scheduleSync()
  }, [scheduleSync, viewport])

  const scrollToEnd = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!viewport) return
    followingRef.current = autoScroll
    viewport.scrollTo({ top: viewport.scrollHeight, behavior })
    scheduleSync()
  }, [autoScroll, scheduleSync, viewport])

  const prepareForPrepend = useCallback(() => {
    if (!viewport) return
    prependRef.current = {
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop
    }
    followingRef.current = false
  }, [viewport])

  const userScrollIntent = useCallback(() => {
    if (!viewport) return
    const { end } = scrollEdges(viewportMetrics(viewport), EDGE_THRESHOLD)
    if (end) followingRef.current = false
  }, [viewport])

  useLayoutEffect(() => {
    if (!viewport || !content) return
    viewport.scrollTop = defaultScrollPosition === 'end' ? viewport.scrollHeight : 0
    lastScrollTopRef.current = viewport.scrollTop
    syncFromViewport()
  }, [content, defaultScrollPosition, syncFromViewport, viewport])

  useEffect(() => {
    if (!viewport || !content) return
    const syncAfterResize = (): void => {
      const prepended = prependRef.current
      if (prepended) {
        prependRef.current = null
        viewport.scrollTop = prepended.scrollTop + (viewport.scrollHeight - prepended.scrollHeight)
      } else if (followingRef.current) {
        viewport.scrollTop = viewport.scrollHeight
      }
      scheduleSync()
    }
    const observer = new ResizeObserver(syncAfterResize)
    observer.observe(viewport)
    observer.observe(content)
    return () => observer.disconnect()
  }, [content, scheduleSync, viewport])

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
  }, [])

  const value = useMemo<ScrollerContextValue>(() => ({
    content,
    prepareForPrepend,
    scrollToEnd,
    scrollToStart,
    setContent,
    setViewport,
    state,
    syncFromViewport: scheduleSync,
    userScrollIntent,
    viewport
  }), [
    content,
    prepareForPrepend,
    scheduleSync,
    scrollToEnd,
    scrollToStart,
    state,
    userScrollIntent,
    viewport
  ])

  return <ScrollerContext.Provider value={value}>{children}</ScrollerContext.Provider>
}

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
  function MessageScrollerViewport({ className, onKeyDown, onPointerDown, onScroll, onTouchStart, onWheel, ...props }, ref) {
    const { setViewport, state, syncFromViewport, userScrollIntent } = useScrollerContext()
    const mergedRef = mergeRefs(ref, setViewport)
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
      if (userScrollKey(event)) userScrollIntent()
      onKeyDown?.(event)
    }
    return (
      <div
        ref={mergedRef}
        role="region"
        aria-label="Messages"
        tabIndex={0}
        data-slot="message-scroller-viewport"
        data-pending-scroll={state.pending ? '' : undefined}
        className={cn('size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain', className)}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => { userScrollIntent(); onPointerDown?.(event) }}
        onScroll={(event) => { syncFromViewport(); onScroll?.(event) }}
        onTouchStart={(event) => { userScrollIntent(); onTouchStart?.(event) }}
        onWheel={(event) => { userScrollIntent(); onWheel?.(event) }}
        {...props}
      />
    )
  }
)

const MessageScrollerContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function MessageScrollerContent({ className, ...props }, ref) {
    const { setContent } = useScrollerContext()
    return (
      <div
        ref={mergeRefs(ref, setContent)}
        role="log"
        aria-relevant="additions"
        data-slot="message-scroller-content"
        className={cn('flex h-max min-h-full flex-col gap-8', className)}
        {...props}
      />
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
  direction?: ScrollPosition
}

function MessageScrollerButton({
  direction = 'end',
  className,
  children,
  onClick,
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
      tabIndex={active ? props.tabIndex : -1}
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

function viewportMetrics(viewport: HTMLElement): ScrollMetrics {
  return {
    clientHeight: viewport.clientHeight,
    scrollHeight: viewport.scrollHeight,
    scrollTop: viewport.scrollTop
  }
}

function userScrollKey(event: KeyboardEvent): boolean {
  return event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'PageUp' ||
    (event.key === ' ' && event.shiftKey)
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
