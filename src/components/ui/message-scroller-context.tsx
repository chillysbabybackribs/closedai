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
  resizeScrollAction,
  scrollEdges,
  type ScrollEdges
} from './message-scroller-state.js'
import { findLastScrollAnchor, isTrailingContent, measureScrollAnchor, viewportMetrics } from './message-scroller-dom.js'

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
  userScrollIntent: (direction?: 'start' | 'end') => void
}

const ScrollerContext = createContext<ScrollerContextValue | null>(null)

export function useScrollerContext(): ScrollerContextValue {
  const value = useContext(ScrollerContext)
  if (!value) throw new Error('MessageScroller components must be inside MessageScrollerProvider')
  return value
}

export function MessageScrollerProvider({
  anchorPrompts = false,
  autoScroll = false,
  children,
  defaultScrollPosition = 'end',
  preservePositionOnNewPrompts = false,
  scrollPreviousItemPeek = 0
}: {
  /**
   * Anchor each newly appended scroll-anchor row (a sent prompt) at the viewport top and stop
   * following, so a long response streams below without pushing its beginning out of view.
   * Unlike `defaultScrollPosition: 'last-anchor'` this does not change where the scroller mounts.
   */
  anchorPrompts?: boolean
  autoScroll?: boolean
  /** Keep agent cycle prompts from pulling a reader away from the transcript they are browsing. */
  preservePositionOnNewPrompts?: boolean
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
  const userScrollingRef = useRef(false)
  const followResumeBlockedRef = useRef(false)
  const prependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const scrollTargetRef = useRef<ScrollPosition | null>(null)
  const frameRef = useRef<number | null>(null)
  const spacerHeightRef = useRef(0)

  const setSpacerHeight = useCallback((height: number) => {
    if (!spacer) return
    const next = Math.max(0, Math.ceil(height))
    if (spacerHeightRef.current === next) return
    spacerHeightRef.current = next
    spacer.hidden = next === 0
    spacer.style.height = `${next}px`
  }, [spacer])

  const syncFromViewport = useCallback(() => {
    if (!viewport) return
    const metrics = viewportMetrics(viewport)
    const delta = metrics.scrollTop - lastScrollTopRef.current
    lastScrollTopRef.current = metrics.scrollTop
    const edges = scrollEdges(metrics, EDGE_THRESHOLD)
    if (delta > 0) followResumeBlockedRef.current = false
    if (!anchoredRef.current) {
      followingRef.current = followingAfterViewportSync(
        followingRef.current, autoScroll, edges, followResumeBlockedRef.current
      )
    }
    if (!edges.end && scrollTargetRef.current === 'end') scrollTargetRef.current = null
    if (!edges.start && scrollTargetRef.current === 'start') scrollTargetRef.current = null
    const userScrolling = userScrollingRef.current
    setState((previous) => {
      // Layout notifications with no movement must not erase the user's scroll direction.
      const direction = !userScrolling ? 'down'
        : delta < 0 ? 'up' : delta > 0 ? 'down' : previous.direction
      return (
        previous.direction === direction &&
        previous.edges.start === edges.start &&
        previous.edges.end === edges.end &&
        !previous.pending
          ? previous
          : { direction, edges, pending: false }
      )
    })
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
    userScrollingRef.current = false
    anchoredRef.current = null
    setSpacerHeight(0)
    followingRef.current = false
    scrollTargetRef.current = 'start'
    viewport.scrollTo({ top: 0, behavior })
    scheduleSync()
  }, [scheduleSync, setSpacerHeight, viewport])

  const scrollToEnd = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!viewport) return
    userScrollingRef.current = false
    anchoredRef.current = null
    setSpacerHeight(0)
    followingRef.current = autoScroll
    followResumeBlockedRef.current = false
    scrollTargetRef.current = 'end'
    viewport.scrollTo({ top: viewport.scrollHeight, behavior })
    scheduleSync()
  }, [autoScroll, scheduleSync, setSpacerHeight, viewport])

  const anchorToElement = useCallback((element: HTMLElement) => {
    if (!viewport || !content || !content.contains(element)) return false
    const measurements = measureScrollAnchor(viewport, content, element, spacer)
    if (!measurements) return false
    userScrollingRef.current = false
    const layout = anchorScrollLayout({
      ...measurements,
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
  }, [content, scheduleSync, scrollPreviousItemPeek, setSpacerHeight, spacer, viewport])

  const prepareForPrepend = useCallback(() => {
    if (!viewport) return
    userScrollingRef.current = false
    anchoredRef.current = null
    setSpacerHeight(0)
    prependRef.current = { scrollHeight: viewport.scrollHeight, scrollTop: viewport.scrollTop }
    followingRef.current = false
    scrollTargetRef.current = null
  }, [setSpacerHeight, viewport])

  const userScrollIntent = useCallback((direction?: 'start' | 'end') => {
    userScrollingRef.current = true
    // Wheel/touch intent arrives before Chromium moves the viewport. A pending layout sync at
    // the old bottom must not re-enable following in that gap and undo the user's next scroll.
    followResumeBlockedRef.current = direction !== 'end'
    if (direction) {
      setState((previous) => ({ ...previous, direction: direction === 'start' ? 'up' : 'down' }))
    }
    if (direction === 'end' && !anchoredRef.current) return
    // Release the anchor but keep its spacer: collapsing it shrinks scrollHeight, the browser
    // clamps scrollTop, and the reader is teleported mid-gesture. The next end or anchor pass
    // resizes it, and follow mode resumes when the reader reaches the bottom.
    anchoredRef.current = null
    followingRef.current = false
    scrollTargetRef.current = null
  }, [])

  useLayoutEffect(() => {
    if (!viewport || !content) return
    userScrollingRef.current = false
    const lastAnchor = findLastScrollAnchor(content, spacer)
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
      const lastAnchor = findLastScrollAnchor(content, spacer)
      const prepended = prependRef.current
      // A new anchor element only counts as a sent prompt while it is the newest row. Replays,
      // wakes, and re-keyed transcripts re-materialize the last prompt with its response already
      // below it; moving the viewport for those would yank a reader mid-transcript.
      const newAnchor = Boolean(
        lastAnchor && lastAnchor !== handledAnchorRef.current && isTrailingContent(lastAnchor, spacer)
      )
      const action = resizeScrollAction({
        prepending: Boolean(prepended),
        newAnchor,
        preservePositionOnNewAnchor: preservePositionOnNewPrompts && newAnchor,
        anchorMode: anchorPrompts || defaultScrollPosition === 'last-anchor',
        anchored: Boolean(anchoredRef.current) && !(preservePositionOnNewPrompts && newAnchor),
        following: followingRef.current,
        autoScroll
      })
      handledAnchorRef.current = lastAnchor
      if (newAnchor && preservePositionOnNewPrompts) {
        anchoredRef.current = null
        setSpacerHeight(0)
      }
      if (action === 'preserve' && prepended) {
        userScrollingRef.current = false
        prependRef.current = null
        viewport.scrollTop = preservedScrollTop(prepended, viewport.scrollHeight)
      } else if (action === 'anchor') {
        const target = lastAnchor ?? anchoredRef.current
        if (target) anchorToElement(target)
      } else if (action === 'end') {
        userScrollingRef.current = false
        anchoredRef.current = null
        setSpacerHeight(0)
        followingRef.current = autoScroll
        viewport.scrollTop = viewport.scrollHeight
      }
      scheduleSync()
    }
    // Mutations arrive as microtasks, so a transcript filling in — or a turn streaming a token at
    // a time — delivers many batches inside one frame, and each one re-anchored the viewport with
    // its own forced layout. Collapsing them into a single animation frame keeps the correction
    // before paint (the frame has not rendered yet) while paying for it once.
    let mutationFrame: number | null = null
    const syncAfterMutations = (): void => {
      if (mutationFrame !== null) return
      mutationFrame = window.requestAnimationFrame(() => {
        mutationFrame = null
        syncAfterResize()
      })
    }
    const observer = new ResizeObserver(syncAfterResize)
    observer.observe(viewport)
    observer.observe(content)
    const mutations = new MutationObserver(syncAfterMutations)
    mutations.observe(content, { childList: true, subtree: true, characterData: true })
    return () => {
      if (mutationFrame !== null) window.cancelAnimationFrame(mutationFrame)
      observer.disconnect()
      mutations.disconnect()
    }
  }, [anchorPrompts, anchorToElement, autoScroll, content, defaultScrollPosition, preservePositionOnNewPrompts,
    scheduleSync, setSpacerHeight, spacer, viewport])

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
