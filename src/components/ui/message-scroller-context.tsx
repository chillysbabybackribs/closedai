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

import {
  anchorScrollLayout,
  followingAfterViewportSync,
  preservedScrollTop,
  scrollEdges,
  type ScrollEdges,
  type ScrollMetrics
} from './message-scroller-state.js'

const EDGE_THRESHOLD = 24

export type ScrollPosition = 'start' | 'end' | 'last-anchor'

export type ScrollerContextValue = {
  prepareForPrepend: () => void
  scrollToEnd: (behavior?: ScrollBehavior) => void
  scrollToStart: (behavior?: ScrollBehavior) => void
  setContent: (element: HTMLDivElement | null) => void
  setSpacer: (element: HTMLDivElement | null) => void
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
  defaultScrollPosition = 'end',
  scrollPreviousItemPeek = 0
}: {
  autoScroll?: boolean
  children: ReactNode
  defaultScrollPosition?: ScrollPosition
  scrollPreviousItemPeek?: number
}): JSX.Element {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const [spacer, setSpacer] = useState<HTMLDivElement | null>(null)
  const [state, setState] = useState<ScrollerContextValue['state']>({
    direction: 'down',
    edges: { start: false, end: false },
    pending: true
  })
  const followingRef = useRef(autoScroll && defaultScrollPosition === 'end')
  const anchoredRef = useRef<HTMLElement | null>(null)
  const handledAnchorRef = useRef<HTMLElement | null>(null)
  const lastScrollTopRef = useRef(0)
  const prependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const scrollTargetRef = useRef<ScrollPosition | null>(null)
  const frameRef = useRef<number | null>(null)
  const spacerHeightRef = useRef(0)

  const setSpacerHeight = useCallback((height: number) => {
    if (!spacer) return
    const next = Math.max(0, Math.ceil(height))
    spacerHeightRef.current = next
    spacer.hidden = next === 0
    spacer.style.height = `${next}px`
  }, [spacer])

  const syncFromViewport = useCallback(() => {
    if (!viewport) return
    const metrics = viewportMetrics(viewport)
    const direction = metrics.scrollTop < lastScrollTopRef.current ? 'up' : 'down'
    lastScrollTopRef.current = metrics.scrollTop
    const edges = scrollEdges(metrics, EDGE_THRESHOLD)
    if (!anchoredRef.current) {
      followingRef.current = followingAfterViewportSync(followingRef.current, autoScroll, edges)
    }
    if (!edges.end && scrollTargetRef.current === 'end') scrollTargetRef.current = null
    if (!edges.start && scrollTargetRef.current === 'start') scrollTargetRef.current = null
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
    anchoredRef.current = null
    setSpacerHeight(0)
    followingRef.current = false
    scrollTargetRef.current = 'start'
    viewport.scrollTo({ top: 0, behavior })
    scheduleSync()
  }, [scheduleSync, setSpacerHeight, viewport])

  const scrollToEnd = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!viewport) return
    anchoredRef.current = null
    setSpacerHeight(0)
    followingRef.current = autoScroll
    scrollTargetRef.current = 'end'
    viewport.scrollTo({ top: viewport.scrollHeight, behavior })
    scheduleSync()
  }, [autoScroll, scheduleSync, setSpacerHeight, viewport])

  const anchorToElement = useCallback((element: HTMLElement) => {
    if (!viewport || !content || !content.contains(element)) return false
    const viewportRect = viewport.getBoundingClientRect()
    const anchorRect = element.getBoundingClientRect()
    const anchorTop = viewport.scrollTop + anchorRect.top - viewportRect.top
    const contentHeight = Math.max(0, viewport.scrollHeight - spacerHeightRef.current)
    const layout = anchorScrollLayout({
      anchorTop,
      contentHeight,
      previousItemPeek: scrollPreviousItemPeek,
      viewportHeight: viewport.clientHeight
    })
    setSpacerHeight(layout.spacerHeight)
    anchoredRef.current = element
    followingRef.current = false
    scrollTargetRef.current = null
    viewport.scrollTop = layout.scrollTop
    lastScrollTopRef.current = viewport.scrollTop
    scheduleSync()
    return true
  }, [content, scheduleSync, scrollPreviousItemPeek, setSpacerHeight, viewport])

  const prepareForPrepend = useCallback(() => {
    if (!viewport) return
    anchoredRef.current = null
    setSpacerHeight(0)
    prependRef.current = { scrollHeight: viewport.scrollHeight, scrollTop: viewport.scrollTop }
    followingRef.current = false
    scrollTargetRef.current = null
  }, [setSpacerHeight, viewport])

  const userScrollIntent = useCallback(() => {
    anchoredRef.current = null
    setSpacerHeight(0)
    followingRef.current = false
    scrollTargetRef.current = null
  }, [setSpacerHeight])

  useLayoutEffect(() => {
    if (!viewport || !content) return
    const lastAnchor = findLastAnchor(content, spacer)
    handledAnchorRef.current = lastAnchor
    if (defaultScrollPosition === 'last-anchor' && lastAnchor) {
      anchorToElement(lastAnchor)
      return
    }
    viewport.scrollTop = defaultScrollPosition === 'end' ? viewport.scrollHeight : 0
    lastScrollTopRef.current = viewport.scrollTop
    syncFromViewport()
  }, [anchorToElement, content, defaultScrollPosition, spacer, syncFromViewport, viewport])

  useEffect(() => {
    if (!viewport || !content) return
    const syncAfterResize = (): void => {
      const lastAnchor = findLastAnchor(content, spacer)
      if (lastAnchor && lastAnchor !== handledAnchorRef.current) {
        handledAnchorRef.current = lastAnchor
        anchorToElement(lastAnchor)
        return
      }
      const prepended = prependRef.current
      if (prepended) {
        prependRef.current = null
        viewport.scrollTop = preservedScrollTop(prepended, viewport.scrollHeight)
      } else if (anchoredRef.current) {
        anchorToElement(anchoredRef.current)
      } else if (followingRef.current) {
        viewport.scrollTop = viewport.scrollHeight
      }
      scheduleSync()
    }
    const observer = new ResizeObserver(syncAfterResize)
    observer.observe(viewport)
    observer.observe(content)
    const mutations = new MutationObserver(syncAfterResize)
    mutations.observe(content, { childList: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [anchorToElement, content, scheduleSync, spacer, viewport])

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
  }, [])

  const value = useMemo<ScrollerContextValue>(() => ({
    prepareForPrepend,
    scrollToEnd,
    scrollToStart,
    setContent,
    setSpacer,
    setViewport,
    state,
    syncFromViewport: scheduleSync,
    userScrollIntent
  }), [prepareForPrepend, scheduleSync, scrollToEnd, scrollToStart, state, userScrollIntent])

  return <ScrollerContext.Provider value={value}>{children}</ScrollerContext.Provider>
}

function findLastAnchor(content: HTMLElement, spacer: HTMLElement | null): HTMLElement | null {
  const children = Array.from(content.children)
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]
    if (child === spacer) continue
    if (child instanceof HTMLElement && child.dataset.scrollAnchor === 'true') return child
  }
  return null
}

function viewportMetrics(viewport: HTMLElement): ScrollMetrics {
  return {
    clientHeight: viewport.clientHeight,
    scrollHeight: viewport.scrollHeight,
    scrollTop: viewport.scrollTop
  }
}
