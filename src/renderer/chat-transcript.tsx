import { BackgroundTasks } from './background-tasks.js'
import type { CSSProperties, JSX } from 'react'
import { memo, useEffect, useMemo, useState } from 'react'
import { ChevronRight, ChevronUp, XCircle } from 'lucide-react'

import { Bubble, BubbleContent } from '../components/ui/bubble.js'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible.js'
import { Markdown } from '../components/ui/markdown.js'
import { Marker, MarkerContent } from '../components/ui/marker.js'
import { Message, MessageContent } from '../components/ui/message.js'
import {
  MessageScrollerItem,
  useMessageScroller,
  useMessageScrollerScrollable
} from '../components/ui/message-scroller.js'
import type { ChatTranscriptItem } from '../shared/chat.js'
import { ActivitySteps } from './activity-step-list.js'
import { MessageActions, type MessageActionContext } from './message-actions.js'
import { ChatScreenshot } from './chat-screenshot.js'
import { TranscriptAttachments } from './composer-attachments.js'
import {
  activityHeadline,
  activityState,
  transcriptRows,
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
  loadEarlier
}: {
  items: ChatTranscriptItem[]
  actions?: MessageActionContext
  activeTurnId?: string | null
  hasEarlier?: boolean
  loadEarlier?: () => Promise<number>
}): JSX.Element {
  const actionMessageIds = useMemo(
    () => turnActionMessageIds(items, activeTurnId, actions?.running || Boolean(activeTurnId)),
    [items, activeTurnId, actions?.running]
  )
  const rows = useMemo(() => transcriptRows(items), [items])
  const [windowStart, setWindowStart] = useState(() => initialWindowStart(rows.length))
  // How many rows off the end may be mounted right now. Opening a chat pays for every row it
  // mounts — markdown parsing, syntax highlighting, one collapsible per tool group — so the
  // first paint takes a screenful and the rest arrives on idle frames after it.
  const [budget, setBudget] = useState(FIRST_PAINT_ROWS)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const { prepareForPrepend } = useMessageScroller()
  const scrollable = useMessageScrollerScrollable()
  const start = Math.max(Math.min(windowStart, initialWindowStart(rows.length)), rows.length - budget, 0)
  const visibleRows = rows.slice(start)

  useEffect(() => {
    if (budget >= INITIAL_VISIBLE_ROWS || rows.length <= budget) return
    const grow = (): void => {
      // A reader parked above the latest message keeps their place; at the end the scroller's
      // own resize handling pins the view, and prepending there would drop it out of follow.
      if (scrollable.end) prepareForPrepend()
      setBudget((current) => Math.min(INITIAL_VISIBLE_ROWS, current + REVEAL_ROW_COUNT))
    }
    const idle = window.requestIdleCallback?.(grow, { timeout: 500 })
    const timer = idle === undefined ? window.setTimeout(grow, 50) : null
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [budget, prepareForPrepend, rows.length, scrollable.end])

  useEffect(() => {
    const jump = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      const index = rows.findIndex((row) => row.kind === 'background' && row.items.some((item) => item.id === id))
      if (index < 0) return
      setWindowStart((current) => Math.min(current, index))
      setBudget((current) => Math.max(current, rows.length - index))
      requestAnimationFrame(() => {
        const target = document.getElementById('background-task-' + id)
        target?.scrollIntoView({ block: 'center', behavior: 'auto' })
        const heading = target?.closest('section')?.querySelector<HTMLButtonElement>('button')
        if (heading?.getAttribute('aria-expanded') === 'false') heading.click()
        heading?.focus({ preventScroll: true })
      })
    }
    window.addEventListener('closedai:background-jump', jump)
    return () => window.removeEventListener('closedai:background-jump', jump)
  }, [rows])

  // A reader away from the latest message keeps a stable window. Once they return to
  // the end, trim excess rows that accumulated during streaming so the DOM stays bounded.
  useEffect(() => {
    if (!scrollable.end && visibleRows.length > MAX_MOUNTED_ROWS) {
      setWindowStart(Math.max(0, rows.length - INITIAL_VISIBLE_ROWS))
    }
  }, [rows.length, scrollable.end, visibleRows.length])

  const revealEarlier = async (): Promise<void> => {
    if (loadingEarlier) return
    prepareForPrepend()
    if (start === 0 && hasEarlier && loadEarlier) {
      setLoadingEarlier(true)
      setHistoryError(null)
      try {
        const count = await loadEarlier()
        setWindowStart(0)
        setBudget((current) => current + count)
      } catch (error) {
        setHistoryError(error instanceof Error ? error.message : 'Could not load earlier messages. Try again.')
      } finally {
        setLoadingEarlier(false)
      }
      return
    }
    const next = Math.max(0, start - REVEAL_ROW_COUNT)
    setWindowStart(next)
    setBudget((current) => Math.max(current, rows.length - next))
  }

  const lastTurnIndex = useMemo(() => lastRowForTurn(rows, activeTurnId), [rows, activeTurnId])

  return (
    <>
      {start > 0 || hasEarlier ? (
        <div className="transcript-fold-banner" role="status">
          <button type="button" data-ui="chat.show-earlier" className="transcript-fold-toggle"
            disabled={loadingEarlier} onClick={() => { void revealEarlier() }}>
            <ChevronUp className="transcript-fold-chevron" aria-hidden="true" />
            <span>{start > 0 ? `${start} earlier ${start === 1 ? 'entry' : 'entries'}` : 'Earlier messages'}</span>
            <span className="transcript-fold-action">{loadingEarlier ? 'Loading…' : 'Show earlier'}</span>
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
            <TranscriptItem item={row.item} actions={actionMessageIds.has(row.item.id) ? actions : undefined} />
          </MessageScrollerItem>
        )
      })}
    </>
  )
})

const INITIAL_VISIBLE_ROWS = 120
const MAX_MOUNTED_ROWS = 160
const REVEAL_ROW_COUNT = 80
/** Rows mounted before the first paint of a chat: about a screenful, whatever the history holds. */
const FIRST_PAINT_ROWS = 24

function initialWindowStart(rowCount: number): number {
  return Math.max(0, rowCount - INITIAL_VISIBLE_ROWS)
}

function rowTurnId(row: TranscriptRow): string | null {
  return row.kind !== 'item' ? (row.items[0]?.turnId ?? null) : (row.item.turnId ?? null)
}

function lastRowForTurn(rows: TranscriptRow[], activeTurnId: string | null | undefined): number {
  if (!activeTurnId) return -1
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rowTurnId(rows[i]!) === activeTurnId) return i
  }
  return -1
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
  actions
}: {
  actions?: MessageActionContext
  item: StandaloneItem
}): JSX.Element | null {
  if (item.type === 'user') {
    return (
      <Message className="message message-user prompt-message prompt-message-user">
        <MessageContent>
          {item.attachments?.length ? <TranscriptAttachments attachments={item.attachments} /> : null}
          {item.text ? (
            <Bubble variant="secondary">
              <BubbleContent className="prompt-message-user-content">{item.text}</BubbleContent>
            </Bubble>
          ) : null}
        </MessageContent>
      </Message>
    )
  }
  if (item.type === 'assistant') {
    if (!item.text) return null
    return <AssistantMessage item={item} actions={actions} />
  }
  if (item.type === 'notice') {
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
  const state = useMemo(() => activityState(items), [items])
  const running = isRunning ?? (state === 'running')
  const headline = useMemo(() => activityHeadline(items, running), [items, running])
  const failed = state === 'failed'
  const status = running ? 'running' : failed ? 'failed' : 'completed'
  return (
    <div className="prompt-tool-activity" data-state={state}>
      <Collapsible open={open} onOpenChange={setOpen}>
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
            {/* Live-ness is carried by the headline's own shimmer rather than a spinner beside it,
                so a turn full of activity rows reads as one moving line instead of a column of
                competing icons. The band is sized from the text length the way the source
                component does it — CSS cannot measure its own glyph count. */}
            <span style={running ? { '--shimmer-spread': `${headline.length * 2}px` } as CSSProperties : undefined}>
              {headline}
            </span>
            <ChevronRight className={`size-3 prompt-process-chevron transition-transform duration-150 ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="prompt-tool-activity-content">
          <div className="prompt-tool-activity-card">
            <ActivitySteps items={items} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}, (prev, next) => sameGroup(prev, next) && prev.isRunning === next.isRunning)

const AssistantMessage = memo(function AssistantMessage({ item, actions }: { item: Extract<ChatTranscriptItem, { type: 'assistant' }>; actions?: MessageActionContext }): JSX.Element {
  return (
    <Message className="message message-assistant prompt-message prompt-message-assistant" data-phase={item.phase ?? 'unknown'}>
      <MessageContent>
        <Bubble variant="ghost">
          <BubbleContent className="prompt-message-assistant-content prose max-w-none dark:prose-invert">
            <Markdown>{item.text}</Markdown>
          </BubbleContent>
        </Bubble>
        {actions ? <MessageActions key={actions.threadKey + item.id} item={item} context={actions} /> : null}
      </MessageContent>
    </Message>
  )
})
