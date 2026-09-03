import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatThreadSummary, ChatTranscriptItem } from '../../shared/chat.js'
import type { ChatPeerSummary } from '../../shared/chat-peers.js'
import type { ChatController } from '../chat-controller.js'
import {
  countDrawerReviewQueue,
  dequeueDrawerReview,
  enqueueDrawerReview,
  expireDrawerReviews,
  markDrawerReviewViewed,
  nextDrawerReviewExpiry,
  persistDrawerReviewQueue,
  pruneDrawerReviewQueue,
  readDrawerReviewQueue,
  type DrawerReviewQueue
} from './drawer-review-queue.js'
import { buildDrawerRows } from './drawer-rows.js'

const COLLAPSED_KEY = 'closedai.drawer.collapsed'
const HISTORY_OPEN_KEY = 'closedai.drawer.historyOpen'

/**
 * Which panes finished a turn and which are running, from one peers update to the next. Every
 * finish counts, watched or not, so a completed chat collects under "Recently completed" instead of
 * sitting in Current wearing a status dot. Panes seen for the first time (startup, a fresh pane)
 * never count as "just finished"; a pane running again has a new message and belongs in Current.
 */
export function reviewTransitions(
  priorRunning: ReadonlyMap<string, boolean>,
  peers: readonly ChatPeerSummary[]
): { finished: string[]; runningAgain: string[]; nextRunning: Map<string, boolean> } {
  const finished: string[] = []
  const runningAgain: string[] = []
  const nextRunning = new Map<string, boolean>()
  for (const peer of peers) {
    nextRunning.set(peer.paneId, peer.running)
    if (peer.running) runningAgain.push(peer.paneId)
    else if (priorRunning.get(peer.paneId) === true) finished.push(peer.paneId)
  }
  return { finished, runningAgain, nextRunning }
}

export function useDrawerController(chat: ChatController) {
  const [isCollapsed, setIsCollapsed] = useState(() => window.localStorage.getItem(COLLAPSED_KEY) === '1')
  const [isHistoryOpen, setIsHistoryOpen] = useState(() => window.localStorage.getItem(HISTORY_OPEN_KEY) === '1')
  const [threads, setThreads] = useState<ChatThreadSummary[]>([])
  const [reviewQueue, setReviewQueue] = useState<DrawerReviewQueue>(() =>
    readDrawerReviewQueue(window.localStorage)
  )
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const priorRunningRef = useRef<Map<string, boolean>>(new Map())

  // Keyed on listThreads (stable, `useCallback(..., [])`) rather than the whole controller, so a
  // thread refresh can never be triggered by an unrelated controller field changing identity.
  const listThreads = chat.listThreads
  const refreshThreads = useCallback(() => {
    void listThreads().then((list) => {
      setThreads(list)
    }).catch(() => {
      // Ignore initial load failure
    })
  }, [listThreads])

  // Listing threads reads every session the provider has stored for this workspace. Switching
  // chats changes the thread id, so running it inline made each switch pay for that scan before
  // the destination could paint; the catalog only feeds row titles, so it can land a beat later.
  useEffect(() => {
    const idle = window.requestIdleCallback?.(refreshThreads, { timeout: 2000 })
    const timer = idle === undefined ? window.setTimeout(refreshThreads, 200) : null
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [refreshThreads, chat.state.threadId])

  // A turn starting or ending is the only thing that moves a row: finishing drops a pane into
  // "Recently completed", sending the next message lifts it back into Current. The pane the user
  // is watching is recorded as completed too, but as already viewed, so it carries no unread mark.
  useEffect(() => {
    if (chat.peers.length === 0) return
    const { finished, runningAgain, nextRunning } = reviewTransitions(priorRunningRef.current, chat.peers)
    priorRunningRef.current = nextRunning
    const livePaneIds = new Set(chat.peers.map((peer) => peer.paneId))
    setReviewQueue((current) => {
      let next = pruneDrawerReviewQueue(current, livePaneIds)
      const now = Date.now()
      for (const paneId of finished) next = enqueueDrawerReview(next, paneId, now)
      for (const paneId of runningAgain) next = dequeueDrawerReview(next, paneId)
      return markDrawerReviewViewed(next, chat.selectedPaneId)
    })
  }, [chat.peers, chat.selectedPaneId])

  // Opening a completed chat reviews it without moving it. It stays visible for a ten-minute
  // grace period unless a new message starts first and returns it to Current.
  useEffect(() => {
    setReviewQueue((current) => markDrawerReviewViewed(current, chat.selectedPaneId))
  }, [chat.selectedPaneId])

  useEffect(() => {
    const expiresAt = nextDrawerReviewExpiry(reviewQueue)
    if (expiresAt === null) return
    const delay = Math.max(0, expiresAt - Date.now())
    const timer = window.setTimeout(() => {
      setReviewQueue((current) => expireDrawerReviews(current, Math.max(Date.now(), expiresAt)))
    }, delay)
    return () => window.clearTimeout(timer)
  }, [reviewQueue])

  useEffect(() => {
    persistDrawerReviewQueue(window.localStorage, reviewQueue)
  }, [reviewQueue])

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((current) => {
      const next = !current
      window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  const toggleHistory = useCallback(() => {
    setIsHistoryOpen((current) => {
      const next = !current
      window.localStorage.setItem(HISTORY_OPEN_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  // Pane rows close (the thread stays in History); history rows archive the thread itself.
  const deleteRow = useCallback(async (id: string, threadId: string | null, paneId?: string) => {
    if (paneId) {
      await chat.closePeer(paneId)
      refreshThreads()
    } else if (threadId) {
      await chat.archiveThread(threadId)
      refreshThreads()
    }
    setReviewQueue((current) => dequeueDrawerReview(current, id))
    setPendingDeleteId(null)
  }, [chat, refreshThreads])

  const linesDiff = useMemo(() => {
    let added = 0
    let removed = 0
    for (const item of chat.state.items) {
      if (item.type === 'fileChange') {
        const counts = countFileChangeDiff(item)
        added += counts.added
        removed += counts.removed
      }
    }
    return { added, removed }
  }, [chat.state.items])

  const rows = useMemo(() => {
    return buildDrawerRows({
      selected: chat.state,
      selectedPaneId: chat.selectedPaneId,
      peers: chat.peers,
      threads,
      selectedDiff: linesDiff
    })
  }, [chat.state, chat.selectedPaneId, chat.peers, threads, linesDiff])

  return {
    isCollapsed,
    toggleCollapsed,
    isHistoryOpen,
    toggleHistory,
    reviewQueue,
    reviewQueueCount: countDrawerReviewQueue(reviewQueue),
    pendingDeleteId,
    setPendingDeleteId,
    deleteRow,
    rows,
    refreshThreads
  }
}

export type DrawerController = ReturnType<typeof useDrawerController>

const fileChangeDiffCache = new WeakMap<object, { added: number; removed: number }>()

function countFileChangeDiff(item: Extract<ChatTranscriptItem, { type: 'fileChange' }>): { added: number; removed: number } {
  const cached = fileChangeDiffCache.get(item)
  if (cached) return cached
  let added = 0
  let removed = 0
  for (const change of item.changes) {
    for (const line of change.diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added += 1
      if (line.startsWith('-') && !line.startsWith('---')) removed += 1
    }
  }
  const result = { added, removed }
  fileChangeDiffCache.set(item, result)
  return result
}
