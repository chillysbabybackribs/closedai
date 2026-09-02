import type { JSX } from 'react'
import { memo, useEffect, useMemo, useState } from 'react'
import { ChevronUp, Loader2, XCircle } from 'lucide-react'

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
import { Tool } from '../components/ui/tool.js'
import type { ChatTranscriptItem } from '../shared/chat.js'
import { ChatScreenshot } from './chat-screenshot.js'
import { TranscriptAttachments } from './composer-attachments.js'
import {
  activityClusters,
  activityHeadline,
  activityState,
  clusterToolPart,
  transcriptRows,
  type ActivityItem,
  type StandaloneItem
} from './transcript-rows.js'

export const ChatTranscript = memo(function ChatTranscript({
  items
}: {
  items: ChatTranscriptItem[]
}): JSX.Element {
  const rows = useMemo(() => transcriptRows(items), [items])
  const [windowStart, setWindowStart] = useState(() => initialWindowStart(rows.length))
  const { prepareForPrepend } = useMessageScroller()
  const scrollable = useMessageScrollerScrollable()
  const start = Math.min(windowStart, initialWindowStart(rows.length))
  const visibleRows = rows.slice(start)

  // A reader away from the latest message keeps a stable window. Once they return to
  // the end, trim excess rows that accumulated during streaming so the DOM stays bounded.
  useEffect(() => {
    if (!scrollable.end && visibleRows.length > MAX_MOUNTED_ROWS) {
      setWindowStart(Math.max(0, rows.length - INITIAL_VISIBLE_ROWS))
    }
  }, [rows.length, scrollable.end, visibleRows.length])

  const revealEarlier = (): void => {
    prepareForPrepend()
    setWindowStart(Math.max(0, start - REVEAL_ROW_COUNT))
  }

  return (
    <>
      {start > 0 ? (
        <div className="transcript-fold-banner" role="status">
          <button type="button" className="transcript-fold-toggle" onClick={revealEarlier}>
            <ChevronUp className="transcript-fold-chevron" aria-hidden="true" />
            <span>{start} earlier {start === 1 ? 'entry' : 'entries'}</span>
            <span className="transcript-fold-action">Show earlier</span>
          </button>
        </div>
      ) : null}
      {visibleRows.map((row) => {
        if (row.kind === 'activity') {
          const id = `activity:${row.id}:${row.items[0]?.id}`
          return (
            <MessageScrollerItem key={id} messageId={id}>
              <ToolActivity items={row.items} />
            </MessageScrollerItem>
          )
        }
        return (
          <MessageScrollerItem
            key={row.item.id}
            messageId={row.item.id}
            className={row.item.type === 'user' ? 'chat-turn-user' : undefined}
          >
            <TranscriptItem item={row.item} />
          </MessageScrollerItem>
        )
      })}
    </>
  )
})

const INITIAL_VISIBLE_ROWS = 120
const MAX_MOUNTED_ROWS = 160
const REVEAL_ROW_COUNT = 80

function initialWindowStart(rowCount: number): number {
  return Math.max(0, rowCount - INITIAL_VISIBLE_ROWS)
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
  item
}: {
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
    return <AssistantMessage item={item} />
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

const ToolActivity = memo(function ToolActivity({ items }: { items: ActivityItem[] }): JSX.Element {
  const [open, setOpen] = useState(false)
  const state = useMemo(() => activityState(items), [items])
  const headline = useMemo(() => activityHeadline(items), [items])
  const clusters = useMemo(() => activityClusters(items), [items])
  const running = state === 'input-streaming'
  const failed = state === 'output-error'
  const status = running ? 'running' : failed ? 'failed' : 'completed'
  return (
    <div className="prompt-tool-activity" data-state={state}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="prompt-tool-activity-trigger"
            aria-label={`${headline}, ${status}`}
          >
            {failed ? (
              <XCircle className="prompt-process-failed" aria-hidden="true" />
            ) : (
              <Loader2 className="prompt-process-spinner animate-spin" aria-hidden="true" />
            )}
            <span>{headline}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="prompt-tool-activity-content">
          {clusters.map((cluster) => (
            <Tool key={cluster.id} className="prompt-transcript-tool" toolPart={clusterToolPart(cluster)} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}, sameGroup)

const AssistantMessage = memo(function AssistantMessage({ item }: { item: Extract<ChatTranscriptItem, { type: 'assistant' }> }): JSX.Element {
  return (
    <Message className="message message-assistant prompt-message prompt-message-assistant" data-phase={item.phase ?? 'unknown'}>
      <MessageContent>
        <Bubble variant="ghost">
          <BubbleContent className="prompt-message-assistant-content prose max-w-none dark:prose-invert">
            <Markdown>{item.text}</Markdown>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
})
