import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatThreadSummary } from '../../shared/chat.js'
import type { ChatController } from '../chat-controller.js'
import {
  countDrawerReviewQueue,
  dequeueDrawerReview,
  enqueueDrawerReview,
  persistDrawerReviewQueue,
  readDrawerReviewQueue,
  type DrawerReviewQueue
} from './drawer-review-queue.js'
import type { DrawerRowModel, DrawerRowStatus } from './drawer-types.js'

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
        for (const change of item.changes) {
          for (const line of change.diff.split('\n')) {
            if (line.startsWith('+') && !line.startsWith('+++')) added += 1
            if (line.startsWith('-') && !line.startsWith('---')) removed += 1
          }
        }
      }
    }
    return { added, removed }
  }, [chat.state.items])

  const rows = useMemo(() => {
    const list: DrawerRowModel[] = []
    const seenThreads = new Set<string>()

    const activeThreadId = chat.state.threadId
    const activeRunning = chat.state.activeTurnId !== null
    if (activeThreadId) {
      seenThreads.add(activeThreadId)
      list.push({
        id: activeThreadId,
        threadId: activeThreadId,
        paneId: chat.selectedPaneId,
        title: chat.state.threadName || 'Active chat',
        cwd: chat.state.cwd || null,
        updatedAt: Date.now(),
        messageCount: chat.state.items.filter((i) => i.type === 'user').length,
        linesAdded: linesDiff.added,
        linesRemoved: linesDiff.removed,
        running: activeRunning,
        status: activeRunning ? 'running' : 'chat',
        provider: chat.state.provider,
        completedUnviewed: false,
        children: []
      })
    }

    const peerRows = new Map<string, DrawerRowModel>()
    for (const peer of chat.peers) {
      if (peer.threadId) seenThreads.add(peer.threadId)
      const status: DrawerRowStatus = peer.running ? 'running' : (peer.activity ? 'done' : 'chat')
      const row: DrawerRowModel = {
        id: peer.paneId,
        threadId: peer.threadId,
        paneId: peer.paneId,
        title: peer.title || (peer.kind === 'subagent' ? 'Subagent task' : 'Peer chat'),
        cwd: chat.state.cwd || null,
        updatedAt: peer.updatedAt,
        messageCount: 0,
        linesAdded: 0,
        linesRemoved: 0,
        running: peer.running,
        status,
        provider: peer.provider,
        peer,
        completedUnviewed: false,
        children: []
      }
      peerRows.set(peer.paneId, row)
    }

    for (const peer of chat.peers) {
      const row = peerRows.get(peer.paneId)!
      if (peer.parentPaneId && peerRows.has(peer.parentPaneId)) {
        peerRows.get(peer.parentPaneId)!.children.push(row)
      } else if (peer.paneId !== chat.selectedPaneId) {
        list.push(row)
      }
    }

    for (const t of threads) {
      if (seenThreads.has(t.id)) continue
      list.push({
        id: t.id,
        threadId: t.id,
        title: t.title,
        cwd: chat.state.cwd || null,
        updatedAt: t.updatedAt,
        messageCount: 1,
        linesAdded: 0,
        linesRemoved: 0,
        running: false,
        status: 'chat',
        thread: t,
        completedUnviewed: false,
        children: []
      })
    }

    return list
  }, [chat.state.threadId, chat.state.threadName, chat.state.cwd, chat.state.items, chat.state.activeTurnId, chat.selectedPaneId, chat.peers, threads, linesDiff])

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
