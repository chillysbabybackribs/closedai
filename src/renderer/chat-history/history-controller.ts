import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { ChatController } from '../chat-controller.js'
import { historyErrorMessage } from './history-format.js'
import {
  dequeueChatReview,
  enqueueChatReview,
  expireChatReviews,
  markChatReviewViewed,
  nextChatReviewExpiry,
  persistChatReviewQueue,
  pruneChatReviewQueue,
  readChatReviewQueue,
  type ChatReviewQueue
} from './review-queue.js'

/** How long a history action failure stays visible in the header. */
const ERROR_VISIBLE_MS = 8000

/**
 * Which chats finished a turn and which are running, from one `chats` update to the next. Every
 * finish counts, watched or not. Chats seen for the first time never count as just finished.
 */
export function reviewTransitions(
  priorRunning: ReadonlyMap<string, boolean>,
  chats: readonly Pick<ChatRowSummary, 'paneId' | 'running' | 'paused'>[]
): { finished: string[]; runningAgain: string[]; nextRunning: Map<string, boolean> } {
  const finished: string[] = []
  const runningAgain: string[] = []
  const nextRunning = new Map<string, boolean>()
  for (const chat of chats) {
    nextRunning.set(chat.paneId, chat.running)
    if (chat.running || chat.paused) runningAgain.push(chat.paneId)
    else if (priorRunning.get(chat.paneId) === true) finished.push(chat.paneId)
  }
  return { finished, runningAgain, nextRunning }
}

export function useHistoryController(
  chat: ChatController,
  /** When set, history opens sync the layout tree (tabs) before main selection paints. */
  openInWorkspace?: (chatId: string) => Promise<void>
) {
  const [reviewQueue, setReviewQueue] = useState<ChatReviewQueue>(() =>
    readChatReviewQueue(window.localStorage)
  )
  const [error, setError] = useState<string | null>(null)
  const priorRunningRef = useRef<Map<string, boolean>>(new Map())

  // Failures used to be swallowed (`.catch(() => {})`) or reach only the console, so a click that
  // did nothing looked like a dead control. History and title actions report here.
  const reportError = useCallback((failure: unknown) => setError(historyErrorMessage(failure)), [])
  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(null), ERROR_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [error])

  // Rows come from the workspace's `chats`; this asks the main process to reconcile the provider
  // catalogs behind them (adopting threads the store has not seen). Keyed on listChats (stable,
  // `useCallback(..., [])`) rather than the whole controller, so a refresh can never be triggered
  // by an unrelated controller field changing identity.
  const listChats = chat.listChats
  const refreshChats = useCallback(() => {
    listChats().catch(reportError)
  }, [listChats, reportError])

  // Reconciling reads every session the providers have stored for this workspace. Switching chats
  // changes the thread id, so running it inline made each switch pay for that scan before the
  // destination could paint; it only refreshes titles, so it can land a beat later.
  useEffect(() => {
    const idle = window.requestIdleCallback?.(refreshChats, { timeout: 2000 })
    const timer = idle === undefined ? window.setTimeout(refreshChats, 200) : null
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [refreshChats, chat.state.threadId])

  // Preserve unread completion markers across detachment and relaunch.
  useEffect(() => {
    if (chat.chats.length === 0) return
    const { finished, runningAgain, nextRunning } = reviewTransitions(priorRunningRef.current, chat.chats)
    priorRunningRef.current = nextRunning
    const knownChatIds = new Set(chat.chats.map((entry) => entry.paneId))
    setReviewQueue((current) => {
      let next = pruneChatReviewQueue(current, knownChatIds)
      const now = Date.now()
      for (const chatId of finished) next = enqueueChatReview(next, chatId, now)
      for (const chatId of runningAgain) next = dequeueChatReview(next, chatId)
      return markChatReviewViewed(next, chat.selectedPaneId)
    })
  }, [chat.chats, chat.selectedPaneId])

  // Opening a completed chat clears its unread marker; closing its tab uses dismissReview instead.
  useEffect(() => {
    setReviewQueue((current) => markChatReviewViewed(current, chat.selectedPaneId))
  }, [chat.selectedPaneId])

  useEffect(() => {
    const expiresAt = nextChatReviewExpiry(reviewQueue)
    if (expiresAt === null) return
    const delay = Math.max(0, expiresAt - Date.now())
    const timer = window.setTimeout(() => {
      setReviewQueue((current) => expireChatReviews(current, Math.max(Date.now(), expiresAt)))
    }, delay)
    return () => window.clearTimeout(timer)
  }, [reviewQueue])

  useEffect(() => {
    persistChatReviewQueue(window.localStorage, reviewQueue)
  }, [reviewQueue])

  /** Open a chat by id; the main process decides whether it takes the blank selected pane or opens beside it. */
  // Keyed on the controller fields used, not the controller: it is rebuilt for every streamed
  // chunk, and a new controller here would hand the title bar and dock new callbacks each time.
  const { selectedPaneId, openChat, newThread, archiveChat, interruptPane: pauseRow, resumePane: resumeRow } = chat
  const openRow = useCallback(async (chatId: string) => {
    if (chatId === selectedPaneId) return
    if (openInWorkspace) await openInWorkspace(chatId)
    else await openChat(chatId)
  }, [selectedPaneId, openChat, openInWorkspace])

  const newChat = useCallback(() => {
    newThread().catch(reportError)
  }, [newThread, reportError])

  const dismissReview = useCallback((chatId: string) => {
    setReviewQueue((current) => markChatReviewViewed(current, chatId))
  }, [])

  const deleteRow = useCallback(async (chatId: string) => {
    dismissReview(chatId)
    await archiveChat(chatId)
  }, [archiveChat, dismissReview])

  return useMemo(() => ({ reviewQueue, openRow, deleteRow, dismissReview, pauseRow, resumeRow, newChat, refreshChats, error, reportError }),
    [reviewQueue, openRow, deleteRow, dismissReview, pauseRow, resumeRow, newChat, refreshChats, error, reportError])
}

export type HistoryController = ReturnType<typeof useHistoryController>
