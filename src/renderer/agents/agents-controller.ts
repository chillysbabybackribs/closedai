import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatThreadSummary } from '../../shared/chat.js'
import type { ChatController } from '../chat-controller.js'
import {
  countAgentReviewQueue,
  dequeueAgentReview,
  enqueueAgentReview,
  persistAgentReviewQueue,
  readAgentReviewQueue,
  type AgentReviewQueue
} from './agent-review-queue.js'
import type { AgentRowModel, AgentStatus } from './agents-types.js'

const COLLAPSED_KEY = 'closedai.agents.collapsed'
const HISTORY_OPEN_KEY = 'closedai.agents.historyOpen'

export function useAgentsController(chat: ChatController) {
  const [isCollapsed, setIsCollapsed] = useState(() => window.localStorage.getItem(COLLAPSED_KEY) === '1')
  const [isHistoryOpen, setIsHistoryOpen] = useState(() => window.localStorage.getItem(HISTORY_OPEN_KEY) === '1')
  const [threads, setThreads] = useState<ChatThreadSummary[]>([])
  const [reviewQueue, setReviewQueue] = useState<AgentReviewQueue>(() =>
    readAgentReviewQueue(window.localStorage)
  )
  const [recentlyCompleted, setRecentlyCompleted] = useState<Record<string, number>>({})
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const priorRunningRef = useRef<Map<string, boolean>>(new Map())

  const refreshThreads = useCallback(() => {
    void chat.listThreads().then((list) => {
      setThreads(list)
    }).catch(() => {
      // Ignore initial load failure
    })
  }, [chat])

  useEffect(() => {
    refreshThreads()
  }, [refreshThreads, chat.state.threadId])

  // Track running -> settled transitions to put settled peers/turns into review queue or recently completed
  useEffect(() => {
    const prior = priorRunningRef.current
    const nextPrior = new Map<string, boolean>()

    // Check active chat
    const activeId = chat.state.threadId ?? 'active-chat'
    const activeRunning = chat.state.activeTurnId !== null
    nextPrior.set(activeId, activeRunning)
    if (prior.get(activeId) && !activeRunning) {
      setRecentlyCompleted((prev) => ({ ...prev, [activeId]: Date.now() }))
    }

    // Check peers
    for (const peer of chat.peers) {
      nextPrior.set(peer.paneId, peer.running)
      if (prior.get(peer.paneId) && !peer.running) {
        setReviewQueue((prev) => enqueueAgentReview(prev, peer.paneId, Date.now()))
        setRecentlyCompleted((prev) => ({ ...prev, [peer.paneId]: Date.now() }))
      }
    }
    priorRunningRef.current = nextPrior
  }, [chat.state.threadId, chat.state.activeTurnId, chat.peers])

  useEffect(() => {
    persistAgentReviewQueue(window.localStorage, reviewQueue)
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
    setReviewQueue((current) => dequeueAgentReview(current, id))
  }, [])

  const dismissReview = useCallback((id: string) => {
    setReviewQueue((current) => dequeueAgentReview(current, id))
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

  // Aggregate lines changed from transcript items if present
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

  // Build unified row models
  const rows = useMemo(() => {
    const list: AgentRowModel[] = []
    const seenThreads = new Set<string>()

    // 1. Current active chat (if threadId or messages exist)
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
        completedUnviewed: false,
        children: []
      })
    }

    // 2. Open peers & subagents
    const peerRows = new Map<string, AgentRowModel>()
    for (const peer of chat.peers) {
      if (peer.threadId) seenThreads.add(peer.threadId)
      const status: AgentStatus = peer.running ? 'running' : (peer.activity ? 'done' : 'chat')
      const row: AgentRowModel = {
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
        peer,
        completedUnviewed: false,
        children: []
      }
      peerRows.set(peer.paneId, row)
    }

    // Link subagents to parent peers if applicable
    for (const peer of chat.peers) {
      const row = peerRows.get(peer.paneId)!
      if (peer.parentPaneId && peerRows.has(peer.parentPaneId)) {
        peerRows.get(peer.parentPaneId)!.children.push(row)
      } else if (peer.paneId !== chat.selectedPaneId) {
        list.push(row)
      }
    }

    // 3. Past threads from workspace
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
    reviewQueueCount: countAgentReviewQueue(reviewQueue),
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

export type AgentsController = ReturnType<typeof useAgentsController>
