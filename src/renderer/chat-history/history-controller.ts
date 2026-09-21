import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatRowSummary } from '../../shared/chat-peers.js'
import type { ChatController } from '../chat-controller.js'
import { historyErrorMessage } from './history-format.js'
import {
  countChatReviewQueue,
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

/** How long a failure stays in the drawer footer before it clears itself. */
const ERROR_VISIBLE_MS = 8000

/**
 * Which chats finished a turn and which are running, from one `chats` update to the next. Every
 * finish counts, watched or not, so a completed chat collects under "Recently completed" instead of
 * sitting in Current wearing a status dot. Chats seen for the first time (startup, a fresh chat)
 * never count as "just finished"; a chat running again has a new message and belongs in Current.
 */
export function reviewTransitions(
  priorRunning: ReadonlyMap<string, boolean>,
  chats: readonly Pick<ChatRowSummary, 'paneId' | 'running'>[]
): { finished: string[]; runningAgain: string[]; nextRunning: Map<string, boolean> } {
  const finished: string[] = []
  const runningAgain: string[] = []
  const nextRunning = new Map<string, boolean>()
  for (const chat of chats) {
    nextRunning.set(chat.paneId, chat.running)
    if (chat.running) runningAgain.push(chat.paneId)
    else if (priorRunning.get(chat.paneId) === true) finished.push(chat.paneId)
  }
  return { finished, runningAgain, nextRunning }
}

export function useHistoryController(chat: ChatController) {
  const [reviewQueue, setReviewQueue] = useState<ChatReviewQueue>(() =>
    readChatReviewQueue(window.localStorage)
  )
  const [error, setError] = useState<string | null>(null)
  const priorRunningRef = useRef<Map<string, boolean>>(new Map())

  // Failures used to be swallowed (`.catch(() => {})`) or reach only the console, so a click that
  // did nothing looked like a dead control. Every drawer action reports here instead.
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

  // A turn starting or ending is the only thing that moves a row: finishing drops a chat into
  // "Recently completed", sending the next message lifts it back into Current. The chat the user
  // is watching is recorded as completed too, but as already viewed, so it carries no unread mark.
  // Entries are pruned against the store's chats, not attached panes, so a completion survives
  // the chat's pane being detached or the app relaunching.
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

  // Opening a completed chat reviews it without moving it. It stays visible for a ten-minute
  // grace period unless a new message starts first and returns it to Current.
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
  const openRow = useCallback(async (chatId: string) => {
    if (chatId === chat.selectedPaneId) return
    await chat.openChat(chatId)
  }, [chat])

  const newChat = useCallback(() => {
    chat.newThread().catch(reportError)
  }, [chat, reportError])

  return { reviewQueue, openRow, newChat, refreshChats, error, reportError }
}

export type HistoryController = ReturnType<typeof useHistoryController>
