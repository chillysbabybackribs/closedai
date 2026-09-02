import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode
} from 'react'

import { scrollEdges, type ScrollEdges, type ScrollMetrics } from './message-scroller-state.js'

const EDGE_THRESHOLD = 24

export type ScrollPosition = 'start' | 'end'

export type ScrollerContextValue = {
  prepareForPrepend: () => void
  scrollToEnd: (behavior?: ScrollBehavior) => void
  scrollToStart: (behavior?: ScrollBehavior) => void
  setContent: (element: HTMLDivElement | null) => void
  setViewport: (element: HTMLDivElement | null) => void
  state: {
    direction: 'up' | 'down'
    edges: ScrollEdges
    pending: boolean
  }
  syncFromViewport: () => void
  userScrollIntent: () => void
}

const ScrollerContext = createContext<ScrollerContextValue | null>(null)

export function useScrollerContext(): ScrollerContextValue {
  const value = useContext(ScrollerContext)
  if (!value) throw new Error('MessageScroller components must be inside MessageScrollerProvider')
  return value
}

export function MessageScrollerProvider({
  autoScroll = false,
  children,
  defaultScrollPosition = 'end'
}: {
  autoScroll?: boolean
  children: ReactNode
  defaultScrollPosition?: ScrollPosition
}): JSX.Element {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const [state, setState] = useState<ScrollerContextValue['state']>({
    direction: 'down',
    edges: { start: false, end: false },
    pending: true
  })
  const followingRef = useRef(autoScroll && defaultScrollPosition === 'end')
  const lastScrollTopRef = useRef(0)
  const prependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
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
    prependRef.current = { scrollHeight: viewport.scrollHeight, scrollTop: viewport.scrollTop }
    followingRef.current = false
  }, [viewport])

  const userScrollIntent = useCallback(() => {
    if (!viewport) return
    if (scrollEdges(viewportMetrics(viewport), EDGE_THRESHOLD).end) followingRef.current = false
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
    prepareForPrepend,
    scrollToEnd,
    scrollToStart,
    setContent,
    setViewport,
    state,
    syncFromViewport: scheduleSync,
    userScrollIntent
  }), [prepareForPrepend, scheduleSync, scrollToEnd, scrollToStart, state, userScrollIntent])

  return <ScrollerContext.Provider value={value}>{children}</ScrollerContext.Provider>
}

function viewportMetrics(viewport: HTMLElement): ScrollMetrics {
  return {
    clientHeight: viewport.clientHeight,
    scrollHeight: viewport.scrollHeight,
    scrollTop: viewport.scrollTop
  }
}
