import { BackgroundTasks } from './background-tasks.js'
import type { CSSProperties, JSX } from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { CHAT_MOUNTED_TURN_WINDOW } from '../shared/chat.js'
import { ChevronRight, ChevronUp, XCircle } from 'lucide-react'

import { Bubble, BubbleContent } from '../components/ui/bubble.js'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible.js'
import { LocalFileMarkdown as Markdown } from './local-file-markdown.js'
import { Marker, MarkerContent } from '../components/ui/marker.js'
import { Message, MessageContent } from '../components/ui/message.js'
import {
  MessageScrollerItem,
  useMessageScroller,
  useMessageScrollerScrollable
} from '../components/ui/message-scroller.js'
import { shouldCollapseBrowsedHistory } from '../components/ui/message-scroller-state.js'
import { usePacedText } from '../components/ui/paced-text.js'
import type { ChatTranscriptItem } from '../shared/chat.js'
import { displayUserMessageText } from '../shared/chat-display.js'
import { ActivitySteps } from './activity-step-list.js'
import { errorMessage } from './error-message.js'
import { MessageActions, type MessageActionContext } from './message-actions.js'
import { ChatScreenshot } from './chat-screenshot.js'
import { TranscriptAttachments } from './composer-attachments.js'
import {
  activityHeadline,
  activityState,
  anchoredVisibleStart,
  clampVisibleStart,
  lastTurnRowStart,
  previousTurnRowStart,
  transcriptRows,
  transcriptRowKey,
  turnActionMessageIds,
  type ActivityItem,
  type StandaloneItem,
  type TranscriptRow
} from './transcript-rows.js'

export const ChatTranscript = memo(function ChatTranscript({
  items,
  activeTurnId,
  actions,
  hasEarlier = false,
  loadEarlier,
  onTrimMountedHistory
}: {
  items: ChatTranscriptItem[]
  actions?: MessageActionContext
  activeTurnId?: string | null
  hasEarlier?: boolean
  loadEarlier?: () => Promise<number>
  onTrimMountedHistory?: () => void
}): JSX.Element {
  const actionMessageIds = useMemo(
    () => turnActionMessageIds(items, activeTurnId, actions?.running || Boolean(activeTurnId)),
    [items, activeTurnId, actions?.running]
  )
  const latestActionId = useMemo(() => {
    let latest: string | null = null
    for (const item of items) {
      if (actionMessageIds.has(item.id)) latest = item.id
    }
    return latest
  }, [items, actionMessageIds])
  const rows = useMemo(() => transcriptRows(items), [items])
  const tailStart = useMemo(() => lastTurnRowStart(rows), [rows])
  const [visibleAnchor, setVisibleAnchor] = useState(() => transcriptRowKey(rows[tailStart]))
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loadEpoch, setLoadEpoch] = useState(0)
  const browsedEarlier = useRef(false)
  const { prepareForPrepend } = useMessageScroller()
  const scrollable = useMessageScrollerScrollable()
  const start = anchoredVisibleStart(visibleAnchor, rows, CHAT_MOUNTED_TURN_WINDOW)
  const setVisibleStart = (index: number): void => setVisibleAnchor(transcriptRowKey(rows[index]))
  const visibleRows = rows.slice(start)

  useEffect(() => {
    browsedEarlier.current = false
    setVisibleStart(tailStart)
  }, [actions?.threadKey])

  useEffect(() => {
    if (loadEpoch === 0) return
    setVisibleStart(clampVisibleStart(previousTurnRowStart(rows, tailStart), rows, CHAT_MOUNTED_TURN_WINDOW))
    setLoadEpoch(0)
  }, [loadEpoch, rows, tailStart])

  useEffect(() => {
    if (start < tailStart) browsedEarlier.current = true
  }, [start, tailStart])

  useEffect(() => {
    if (!shouldCollapseBrowsedHistory(scrollable, browsedEarlier.current)) return
    browsedEarlier.current = false
    setVisibleStart(tailStart)
    onTrimMountedHistory?.()
  }, [scrollable.end, scrollable.start, tailStart, onTrimMountedHistory])

  const revealEarlier = async (): Promise<void> => {
    if (loadingEarlier) return
    prepareForPrepend()
    if (start > 0) {
      setVisibleStart(clampVisibleStart(previousTurnRowStart(rows, start), rows, CHAT_MOUNTED_TURN_WINDOW))
      return
    }
    if (!hasEarlier || !loadEarlier) return
    setLoadingEarlier(true)
    setHistoryError(null)
    try {
      const count = await loadEarlier()
      if (count > 0) setLoadEpoch((epoch) => epoch + 1)
    } catch (error) {
      setHistoryError(errorMessage(error, 'Could not load earlier messages. Try again.'))
    } finally {
      setLoadingEarlier(false)
    }
  }

  const lastTurnIndex = useMemo(() => lastRowForTurn(rows, activeTurnId), [rows, activeTurnId])
  const showEarlier = start > 0 || hasEarlier

  return (
    <>
      {showEarlier ? (
        <div className="transcript-fold-banner" role="status">
          <button type="button" data-ui="chat.show-earlier" className="transcript-fold-toggle"
            disabled={loadingEarlier} onClick={() => { void revealEarlier() }}>
            <ChevronUp className="transcript-fold-chevron" aria-hidden="true" />
            <span>{loadingEarlier ? 'Loading…' : 'View previous messages'}</span>
          </button>
        </div>
      ) : null}
      {historyError ? <p className="transcript-history-error" role="alert">{historyError}</p> : null}
      {visibleRows.map((row, index) => {
        if (row.kind === 'background') {
          return <MessageScrollerItem key={`background:${row.id}`} messageId={`background:${row.id}`}>
            <BackgroundTasks items={row.items} />
          </MessageScrollerItem>
        }
        if (row.kind === 'activity') {
          const id = `activity:${row.id}:${row.items[0]?.id}`
          const isRunning = isActivityRowRunning(row, start + index, lastTurnIndex, activeTurnId)
          return (
            <MessageScrollerItem key={id} messageId={id}>
              <ToolActivity items={row.items} isRunning={isRunning} />
            </MessageScrollerItem>
          )
        }
        return (
          <MessageScrollerItem
            key={row.item.id}
            messageId={row.item.id}
            scrollAnchor={row.item.type === 'user'}
            className={row.item.type === 'user' ? 'chat-turn-user' : undefined}
          >
            <TranscriptItem item={row.item} actions={actionMessageIds.has(row.item.id) ? actions : undefined}
              showContinue={row.item.id === latestActionId} />
          </MessageScrollerItem>
        )
      })}
    </>
  )
})

function lastRowForTurn(rows: TranscriptRow[], activeTurnId: string | null | undefined): number {
  if (!activeTurnId) return -1
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rowTurnId(rows[i]!) === activeTurnId) return i
  }
  return -1
}

function rowTurnId(row: TranscriptRow): string | null {
  return row.kind !== 'item' ? (row.items[0]?.turnId ?? null) : (row.item.turnId ?? null)
}

function isActivityRowRunning(
  row: Extract<TranscriptRow, { kind: 'activity' }>,
  index: number,
  lastTurnIndex: number,
  activeTurnId: string | null | undefined
): boolean {
  if (row.items.some((item) => item.status === 'inProgress')) {
    return true
  }
  if (!activeTurnId) return false
  const turnId = row.items[0]?.turnId
  if (!turnId || turnId !== activeTurnId) return false
  return index >= lastTurnIndex
}

/** Consecutive batches can share a turn id; pin the first member so React does not reuse the wrong group. */
function sameGroup<T extends { items: readonly unknown[] }>(previous: T, next: T): boolean {
  if (previous.items.length !== next.items.length) return false
  for (const [key, value] of Object.entries(next)) {
    if (key !== 'items' && (previous as Record<string, unknown>)[key] !== value) return false
  }
  return previous.items.every((item, index) => item === next.items[index])
}

const TranscriptItem = memo(function TranscriptItem({
  item,
  actions,
  showContinue
}: {
  actions?: MessageActionContext
  item: StandaloneItem
  showContinue?: boolean
}): JSX.Element | null {
  if (item.type === 'user') {
    const text = item.text ? displayUserMessageText(item.text) : ''
    return (
      <Message className="message message-user prompt-message prompt-message-user">
        <MessageContent>
          {item.attachments?.length ? <TranscriptAttachments attachments={item.attachments} /> : null}
          {text ? (
            <Bubble variant="secondary">
              <BubbleContent className="prompt-message-user-content">{text}</BubbleContent>
            </Bubble>
          ) : null}
        </MessageContent>
      </Message>
    )
  }
  if (item.type === 'assistant') {
    if (!item.text) return null
    return <AssistantMessage item={item} actions={actions} showContinue={showContinue} />
  }
  if (item.type === 'notice') {
    if (item.tone === 'info' && item.text.startsWith('Continuing from')) return null
    return (
      <Marker
        className="prompt-system-message w-fit"
        data-tone={item.tone}
        role={item.tone === 'error' ? 'alert' : 'status'}
      >
        <MarkerContent>{item.text}</MarkerContent>
      </Marker>
    )
  }
  if (item.type === 'screenshot') return <ChatScreenshot item={item} />
  return null
})

const ToolActivity = memo(function ToolActivity({
  items,
  isRunning
}: {
  items: ActivityItem[]
  isRunning?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [opened, setOpened] = useState(false)
  const state = useMemo(() => activityState(items), [items])
  const running = isRunning ?? (state === 'running')
  const headline = useMemo(() => activityHeadline(items, running), [items, running])
  const failed = state === 'failed'
  const status = running ? 'running' : failed ? 'failed' : 'completed'
  return (
    <div className="prompt-tool-activity" data-state={state}>
      <Collapsible open={open} onOpenChange={(next) => { if (next) setOpened(true); setOpen(next) }}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="prompt-tool-activity-trigger"
            data-running={running || undefined}
            aria-label={`${headline}, ${status}`}
          >
            {failed && open ? (
              <XCircle className="prompt-process-failed" aria-hidden="true" />
            ) : null}
            <span style={running ? { '--shimmer-spread': `${headline.length * 2}px` } as CSSProperties : undefined}>
              {headline}
            </span>
            <ChevronRight className={`size-3 prompt-process-chevron transition-transform duration-150 ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
          </button>
        </CollapsibleTrigger>
        {opened ? (
          <CollapsibleContent className="prompt-tool-activity-content">
            <div className="prompt-tool-activity-card">
              <ActivitySteps items={items} />
            </div>
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </div>
  )
}, (prev, next) => sameGroup(prev, next) && prev.isRunning === next.isRunning)

const AssistantMessage = memo(function AssistantMessage({ item, actions, showContinue }: {
  item: Extract<ChatTranscriptItem, { type: 'assistant' }>
  actions?: MessageActionContext
  showContinue?: boolean
}): JSX.Element | null {
  // The displayed text trails what has streamed in by a bounded catch-up window, so one-token,
  // sentence-burst, and whole-message chunk cadences all paint as the same typewriter. Settled
  // items render in full immediately; the drain also finishes turns that never settle their item.
  const text = usePacedText(item.text, !item.streaming)
  const streaming = Boolean(item.streaming) || text.length < item.text.length
  if (!text) return null
  return (
    <Message className="message message-assistant prompt-message prompt-message-assistant" data-phase={item.phase ?? 'unknown'}>
      <MessageContent>
        <Bubble variant="ghost">
          <BubbleContent className="prompt-message-assistant-content prose max-w-none dark:prose-invert">
            <Markdown streaming={streaming}>{text}</Markdown>
          </BubbleContent>
        </Bubble>
        {actions ? <MessageActions key={actions.threadKey + item.id} item={item} context={actions}
          showContinue={showContinue} /> : null}
      </MessageContent>
    </Message>
  )
})
