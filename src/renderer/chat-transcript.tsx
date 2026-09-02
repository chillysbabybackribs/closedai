import type { JSX } from 'react'
import { memo, useMemo, useState } from 'react'
import { ChevronDown, Loader2, XCircle } from 'lucide-react'

import { Bubble, BubbleContent } from '../components/ui/bubble.js'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible.js'
import { Markdown } from '../components/ui/markdown.js'
import { Marker, MarkerContent } from '../components/ui/marker.js'
import { Message, MessageContent } from '../components/ui/message.js'
import { MessageScrollerItem } from '../components/ui/message-scroller.js'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '../components/ui/reasoning.js'
import { TextShimmer } from '../components/ui/text-shimmer.js'
import { Tool } from '../components/ui/tool.js'
import type { ChatTranscriptItem } from '../shared/chat.js'
import { ChatScreenshot } from './chat-screenshot.js'
import { TranscriptAttachments } from './composer-attachments.js'
import {
  activityClusters,
  activityHeadline,
  activityState,
  clusterToolPart,
  type ActivityItem,
  type ReasoningItem,
  type StandaloneItem,
  visibleTranscriptRows
} from './transcript-rows.js'

export const ChatTranscript = memo(function ChatTranscript({
  items,
  activeTurnId
}: {
  items: ChatTranscriptItem[]
  activeTurnId: string | null
}): JSX.Element {
  const rows = useMemo(() => visibleTranscriptRows(items, activeTurnId), [items, activeTurnId])
  return (
    <>
      {rows.map((row) => {
        if (row.kind === 'activity') {
          const id = `activity:${row.id}:${row.items[0]?.id}`
          return (
            <MessageScrollerItem key={id} messageId={id}>
              <ToolActivity items={row.items} />
            </MessageScrollerItem>
          )
        }
        if (row.kind === 'reasoning') {
          return (
            <MessageScrollerItem key={`reasoning:${row.id}`} messageId={`reasoning:${row.id}`}>
              <ThinkingLine items={row.items} active={row.id === activeTurnId} />
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
            <TranscriptItem item={row.item} />
          </MessageScrollerItem>
        )
      })}
    </>
  )
})

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
      <Message align="end" className="message message-user prompt-message prompt-message-user">
        <MessageContent>
          {item.attachments?.length ? <TranscriptAttachments attachments={item.attachments} /> : null}
          {item.text ? (
            <Bubble variant="secondary" align="end">
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

const ThinkingLine = memo(function ThinkingLine({ items, active }: { items: ReasoningItem[]; active: boolean }): JSX.Element | null {
  const streaming = active && (items.length === 0 || items.some((item) => item.streaming))
  const text = items.map((item) => item.text).filter(Boolean).join('\n\n')
  const label = streaming ? 'Thinking' : items.length && items.every((item) => item.type === 'plan') ? 'Plan' : 'Thought'
  if (!text && !streaming) return null
  if (streaming && !text) {
    return (
      <Marker role="status" className="prompt-reasoning">
        <MarkerContent>
          <TextShimmer as="span" className="prompt-reasoning-label">Thinking</TextShimmer>
        </MarkerContent>
      </Marker>
    )
  }
  return (
    <Reasoning className="prompt-reasoning">
      <ReasoningTrigger className="prompt-reasoning-trigger" aria-label={label}>
        {streaming
          ? <TextShimmer as="span" className="prompt-reasoning-label">Thinking</TextShimmer>
          : <span className="prompt-reasoning-label">{label}</span>}
      </ReasoningTrigger>
      {text ? (
        <ReasoningContent markdown className="prompt-reasoning-content" contentClassName="prompt-reasoning-copy prose prose-sm max-w-none dark:prose-invert">
          {text}
        </ReasoningContent>
      ) : null}
    </Reasoning>
  )
}, (previous, next) => previous.active === next.active && sameGroup(previous, next))

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
            {running ? <Loader2 className="prompt-process-spinner animate-spin" aria-hidden="true" /> : null}
            {failed ? <XCircle className="prompt-process-failed" aria-hidden="true" /> : null}
            <span>{headline}</span>
            <ChevronDown className={open ? 'prompt-tool-activity-caret is-open' : 'prompt-tool-activity-caret'} aria-hidden="true" />
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
          <BubbleContent className="prompt-message-assistant-content prose max-w-none prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h4:text-base prose-h5:text-sm prose-h6:text-xs dark:prose-invert">
            <Markdown>{item.text}</Markdown>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
})
