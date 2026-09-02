import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatThreadSummary, ChatTranscriptItem } from '../../shared/chat.js'
import type { ChatController } from '../chat-controller.js'
import {
  countDrawerReviewQueue,
  dequeueDrawerReview,
  enqueueDrawerReview,
  persistDrawerReviewQueue,
  readDrawerReviewQueue,
  type DrawerReviewQueue
} from './drawer-review-queue.js'
import { buildDrawerRows } from './drawer-rows.js'

const COLLAPSED_KEY = 'closedai.drawer.collapsed'
const HISTORY_OPEN_KEY = 'closedai.drawer.historyOpen'

export function useDrawerController(chat: ChatController) {
  const [isCollapsed, setIsCollapsed] = useState(() => window.localStorage.getItem(COLLAPSED_KEY) === '1')
  const [isHistoryOpen, setIsHistoryOpen] = useState(() => window.localStorage.getItem(HISTORY_OPEN_KEY) === '1')
  const [threads, setThreads] = useState<ChatThreadSummary[]>([])
  const [reviewQueue, setReviewQueue] = useState<DrawerReviewQueue>(() =>
    readDrawerReviewQueue(window.localStorage)
  )
  const [recentlyCompleted, setRecentlyCompleted] = useState<Record<string, number>>({})
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

  useEffect(() => {
    refreshThreads()
  }, [refreshThreads, chat.state.threadId])

  useEffect(() => {
    const prior = priorRunningRef.current
    const nextPrior = new Map<string, boolean>()

    const activeId = chat.state.threadId ?? 'active-chat'
    const activeRunning = chat.state.activeTurnId !== null
    nextPrior.set(activeId, activeRunning)
    if (prior.get(activeId) && !activeRunning) {
      setRecentlyCompleted((prev) => ({ ...prev, [activeId]: Date.now() }))
    }

    for (const peer of chat.peers) {
      nextPrior.set(peer.paneId, peer.running)
      if (prior.get(peer.paneId) && !peer.running) {
        setReviewQueue((prev) => enqueueDrawerReview(prev, peer.paneId, Date.now()))
        setRecentlyCompleted((prev) => ({ ...prev, [peer.paneId]: Date.now() }))
      }
    }
    priorRunningRef.current = nextPrior
  }, [chat.state.threadId, chat.state.activeTurnId, chat.peers])

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

  const acceptReview = useCallback((id: string) => {
    setReviewQueue((current) => dequeueDrawerReview(current, id))
  }, [])

  const dismissReview = useCallback((id: string) => {
    setReviewQueue((current) => dequeueDrawerReview(current, id))
  }, [])

  const deleteRow = useCallback(async (id: string, threadId: string | null, paneId?: string) => {
    if (paneId && paneId !== chat.selectedPaneId) {
      await chat.closePeer(paneId)
    } else if (threadId) {
      await chat.archiveThread(threadId)
      refreshThreads()
    }
    dismissReview(id)
    setPendingDeleteId(null)
  }, [chat, dismissReview, refreshThreads])

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
    recentlyCompleted,
    pendingDeleteId,
    setPendingDeleteId,
    acceptReview,
    dismissReview,
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
