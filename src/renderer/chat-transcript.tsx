import type { JSX } from 'react'
import { memo, useMemo, useState } from 'react'
import { Check, CheckCircle2, ChevronDown, CircleEllipsis, Copy, Loader2, XCircle } from 'lucide-react'

import { Button } from '../components/ui/button.js'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible.js'
import { Message, MessageAction, MessageActions, MessageContent } from '../components/ui/message.js'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '../components/ui/reasoning.js'
import { Tool, type ToolPart } from '../components/ui/tool.js'
import type { ChatTranscriptItem } from '../shared/chat.js'
import { ChatScreenshot } from './chat-screenshot.js'

type ActivityItem = Extract<ChatTranscriptItem, { type: 'command' | 'fileChange' | 'tool' }>
type ReasoningItem = Extract<ChatTranscriptItem, { type: 'plan' | 'reasoning' }>
type StandaloneItem = Exclude<ChatTranscriptItem, ActivityItem | ReasoningItem>

export type TranscriptRow =
  | { kind: 'item'; item: StandaloneItem }
  | { kind: 'activity'; id: string; items: ActivityItem[] }
  | { kind: 'reasoning'; id: string; items: ReasoningItem[] }

export function transcriptRows(items: ChatTranscriptItem[]): TranscriptRow[] {
  const byTurn = new Map<string, ActivityItem[]>()
  const reasoningByTurn = new Map<string, ReasoningItem[]>()
  for (const item of items) {
    const key = item.turnId ?? `item:${item.id}`
    if (isActivity(item)) byTurn.set(key, [...(byTurn.get(key) ?? []), item])
    if (isReasoning(item)) reasoningByTurn.set(key, [...(reasoningByTurn.get(key) ?? []), item])
  }
  const emittedActivity = new Set<string>()
  const emittedReasoning = new Set<string>()
  const rows: TranscriptRow[] = []
  for (const item of items) {
    const key = item.turnId ?? `item:${item.id}`
    if (isActivity(item)) {
      if (emittedActivity.has(key)) continue
      emittedActivity.add(key)
      rows.push({ kind: 'activity', id: key, items: byTurn.get(key) ?? [item] })
      continue
    }
    if (isReasoning(item)) {
      if (emittedReasoning.has(key)) continue
      emittedReasoning.add(key)
      rows.push({ kind: 'reasoning', id: key, items: reasoningByTurn.get(key) ?? [item] })
      continue
    }
    rows.push({ kind: 'item', item })
  }
  return rows
}

export function hasReasoningForTurn(items: ChatTranscriptItem[], turnId: string): boolean {
  return items.some((item) => item.turnId === turnId && isReasoning(item))
}

export const ChatTranscript = memo(function ChatTranscript({
  items,
  activeTurnId
}: {
  items: ChatTranscriptItem[]
  activeTurnId: string | null
}): JSX.Element {
  const rows = useMemo(() => transcriptRows(items), [items])
  return (
    <>
      {rows.map((row) => row.kind === 'activity'
        ? <ToolActivity key={`activity:${row.id}`} items={row.items} />
        : row.kind === 'reasoning'
          ? <ReasoningGroup key={`reasoning:${row.id}`} items={row.items} running={activeTurnId === row.id} />
          : <TranscriptItem key={row.item.id} item={row.item} />)}
    </>
  )
})

/** Grouped rows get a fresh array each pass; the group is unchanged when every member is. */
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
      <Message className="prompt-message prompt-message-user">
        <div className="prompt-message-user-stack">
          {item.attachments?.length ? (
            <div className="prompt-message-user-attachments">
              {item.attachments.map((attachment) => (
                <span key={attachment.id}>{attachment.kind === 'image' ? 'Image' : 'File'} · {attachment.name}</span>
              ))}
            </div>
          ) : null}
          {item.text && <MessageContent className="prompt-message-user-content">{item.text}</MessageContent>}
        </div>
      </Message>
    )
  }
  if (item.type === 'assistant') {
    if (!item.text) return null
    return <AssistantMessage item={item} />
  }
  if (item.type === 'notice') {
    return <div className="prompt-system-message" data-tone={item.tone} role={item.tone === 'error' ? 'alert' : 'status'}>{item.text}</div>
  }
  if (item.type === 'screenshot') return <ChatScreenshot item={item} />
  return null
})

const ReasoningGroup = memo(function ReasoningGroup({ items, running }: { items: ReasoningItem[]; running: boolean }): JSX.Element {
  const onlyPlans = items.every((item) => item.type === 'plan')
  const text = items.map((item) => item.text).filter(Boolean).join('\n\n')
  return (
    <Reasoning className="prompt-reasoning" isStreaming={running}>
      <ReasoningTrigger className="prompt-reasoning-trigger">
        {running ? 'Thinking…' : onlyPlans ? 'Plan' : 'Reasoning'}
      </ReasoningTrigger>
      <ReasoningContent markdown className="prompt-reasoning-content" contentClassName="prompt-reasoning-copy prose prose-sm max-w-none dark:prose-invert">
        {text}
      </ReasoningContent>
    </Reasoning>
  )
}, sameGroup)

const ToolActivity = memo(function ToolActivity({ items }: { items: ActivityItem[] }): JSX.Element {
  const [open, setOpen] = useState(false)
  const state = useMemo(() => activityState(items), [items])
  const status = statusPresentation(state)
  const count = items.length
  return (
    <div className="prompt-tool-activity" data-state={state}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="prompt-tool-activity-trigger"
            aria-label={`${count} tool call${count === 1 ? '' : 's'}, ${status.label}`}
          >
            <status.Icon className={status.spin ? 'animate-spin' : undefined} aria-hidden="true" />
            <span>{count} tool call{count === 1 ? '' : 's'}</span>
            <em>{status.label}</em>
            <ChevronDown className={open ? 'prompt-tool-activity-caret is-open' : 'prompt-tool-activity-caret'} aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="prompt-tool-activity-content">
          {items.map((item) => <Tool key={item.id} className="prompt-transcript-tool" toolPart={toolPart(item)} />)}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}, sameGroup)

const AssistantMessage = memo(function AssistantMessage({ item }: { item: Extract<ChatTranscriptItem, { type: 'assistant' }> }): JSX.Element {
  const [copied, setCopied] = useState(false)
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(item.text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Message className="prompt-message prompt-message-assistant" data-phase={item.phase ?? 'unknown'}>
      <div className="prompt-message-assistant-stack">
        <MessageContent
          markdown
          className="prompt-message-assistant-content prose max-w-none prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h4:text-base prose-h5:text-sm prose-h6:text-xs dark:prose-invert"
        >
          {item.text}
        </MessageContent>
        {!item.streaming && (
          <MessageActions className="prompt-message-actions">
            <MessageAction tooltip={copied ? 'Copied' : 'Copy response'}>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Copy response" onClick={() => void copy()}>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              </Button>
            </MessageAction>
          </MessageActions>
        )}
      </div>
    </Message>
  )
})

function toolPart(item: ActivityItem): ToolPart {
  if (item.type === 'command') {
    return {
      type: item.command,
      state: toolState(item.status, item.exitCode),
      input: item.cwd ? { cwd: item.cwd } : undefined,
      output: item.output ? { output: item.output, exitCode: item.exitCode } : undefined,
      errorText: item.exitCode !== null && item.exitCode !== 0 ? `Command exited with code ${item.exitCode}` : undefined,
      toolCallId: item.id
    }
  }
  if (item.type === 'fileChange') {
    return {
      type: `${item.changes.length} file change${item.changes.length === 1 ? '' : 's'}`,
      state: toolState(item.status, null),
      input: { files: item.changes.map(({ path, kind }) => ({ path, kind })) },
      output: item.changes.some((change) => change.diff)
        ? { diffs: item.changes.filter((change) => change.diff).map(({ path, diff }) => ({ path, diff })) }
        : undefined,
      toolCallId: item.id
    }
  }
  return {
    type: item.label,
    state: toolState(item.status, null),
    input: item.detail ? { detail: item.detail } : undefined,
    toolCallId: item.id
  }
}

function isActivity(item: ChatTranscriptItem): item is ActivityItem {
  return item.type === 'command' || item.type === 'fileChange' || item.type === 'tool'
}

function isReasoning(item: ChatTranscriptItem): item is ReasoningItem {
  return item.type === 'plan' || item.type === 'reasoning'
}

function activityState(items: ActivityItem[]): ToolPart['state'] {
  const states = items.map((item) => toolPart(item).state)
  if (states.includes('input-streaming')) return 'input-streaming'
  if (states.includes('output-error')) return 'output-error'
  if (states.includes('input-available')) return 'input-available'
  return 'output-available'
}

function statusPresentation(state: ToolPart['state']): {
  Icon: typeof CircleEllipsis
  label: string
  spin?: boolean
} {
  switch (state) {
    case 'input-streaming': return { Icon: Loader2, label: 'Running', spin: true }
    case 'input-available': return { Icon: CircleEllipsis, label: 'Waiting' }
    case 'output-error': return { Icon: XCircle, label: 'Failed' }
    case 'output-available': return { Icon: CheckCircle2, label: 'Completed' }
  }
}

function toolState(status: string, exitCode: number | null): ToolPart['state'] {
  const normalized = status.toLowerCase()
  if (normalized.includes('progress') || normalized.includes('running')) return 'input-streaming'
  if (normalized.includes('fail') || normalized.includes('error') || (exitCode !== null && exitCode !== 0)) return 'output-error'
  if (normalized.includes('pending') || normalized.includes('request')) return 'input-available'
  return 'output-available'
}
