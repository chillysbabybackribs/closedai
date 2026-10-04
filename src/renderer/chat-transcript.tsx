import { usePerformanceSettings } from './performance/performance-settings.js'
import { useResponsePaint } from './performance/use-response-paint.js'
import { BackgroundTasks } from './background-tasks.js'
import type { JSX } from 'react'
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, ChevronUp, XCircle } from './icons/index.js'

import { Bubble, BubbleContent } from '../components/ui/bubble.js'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible.js'
import { LocalFileMarkdown as Markdown } from './local-file-markdown.js'
import { Marker, MarkerContent } from '../components/ui/marker.js'
import { Message, MessageContent } from '../components/ui/message.js'
import { NumberTicker } from '../components/ui/number-ticker.js'
import { useScrollerContext } from '../components/ui/message-scroller-context.js'
import { shouldCollapseBrowsedHistory } from '../components/ui/message-scroller-state.js'
import {
  MessageScrollerItem,
  useMessageScroller,
  useMessageScrollerPromptAnchorInset
} from '../components/ui/message-scroller.js'
import { usePacedText } from '../components/ui/paced-text.js'
import type { ChatTranscriptItem } from '../shared/chat.js'
import { displayUserMessageText } from '../shared/chat-display.js'
import { ActivitySteps, KindIcon, LiveLine, useClock } from './activity-step-list.js'
import { activitySteps, diffCounts } from './activity-steps.js'
import { errorMessage } from './error-message.js'
import { MessageActions, type MessageActionContext } from './message-actions.js'
import { ChatScreenshot, ScreenshotStrip } from './chat-screenshot.js'
import { RollSlot } from './turn-stage.js'
import { TranscriptAttachments } from './composer-attachments.js'
import {
  activityHeadline,
  activityState,
  hiddenTranscriptNotice,
  transcriptRows,
  turnActionMessageIds,
  turnLayout,
  type ActivityItem,
  type ScreenshotItem,
  type StandaloneItem,
  type TranscriptRow,
  type TurnHead,
  type TurnStage
} from './transcript-rows.js'
export const ChatTranscript = memo(function ChatTranscript({
  items,
  paneId,
  activeTurnId,
  actions,
  hasEarlier = false,
  loadEarlier,
  trimMountedHistory,
  cwd
}: {
  items: ChatTranscriptItem[]
  paneId?: string
  actions?: MessageActionContext
  activeTurnId?: string | null
  hasEarlier?: boolean
  loadEarlier?: () => Promise<number>
  /** Drop prepended turns once the reader scrolls back to the latest messages. */
  trimMountedHistory?: () => void
  cwd?: string
}): JSX.Element {
  const actionMessageIds = useMemo(
    () => turnActionMessageIds(items, activeTurnId, actions?.running || Boolean(activeTurnId)),
    [items, activeTurnId, actions?.running]
  )
  const rows = useMemo(() => transcriptRows(items), [items])
  const turnRunning = Boolean(activeTurnId) || Boolean(actions?.running)
  const layout = useMemo(() => turnLayout(rows, turnRunning), [rows, turnRunning])
  // Settled turns start folded; a click on the header flips just that turn.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set())
  const toggleTurn = useCallback((key: string) => setFlipped((current) => {
    const next = new Set(current)
    if (!next.delete(key)) next.add(key)
    return next
  }), [])
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const foldBannerRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef(false)
  const browsedEarlierRef = useRef(false)
  const { prepareForPrepend } = useMessageScroller()
  const { state: scrollState } = useScrollerContext()
  const setPromptAnchorTopInset = useMessageScrollerPromptAnchorInset()

  useLayoutEffect(() => {
    if (!trimMountedHistory || !browsedEarlierRef.current) return
    if (!shouldCollapseBrowsedHistory(scrollState.edges, true)) return
    browsedEarlierRef.current = false
    trimMountedHistory()
  }, [scrollState.edges, trimMountedHistory])

  const revealEarlier = async (): Promise<void> => {
    if (requestRef.current || !hasEarlier || !loadEarlier) return
    requestRef.current = true
    prepareForPrepend()
    setLoadingEarlier(true)
    setHistoryError(null)
    try {
      const loaded = await loadEarlier()
      if (loaded > 0) browsedEarlierRef.current = true
    } catch (error) {
      setHistoryError(errorMessage(error, 'Could not load earlier messages. Try again.'))
    } finally {
      requestRef.current = false
      setLoadingEarlier(false)
    }
  }

  const lastTurnIndex = useMemo(() => lastRowForTurn(rows, activeTurnId), [rows, activeTurnId])
  const showEarlier = hasEarlier

  useLayoutEffect(() => {
    if (!showEarlier) {
      setPromptAnchorTopInset(0)
      return
    }
    const banner = foldBannerRef.current
    if (!banner) {
      setPromptAnchorTopInset(0)
      return
    }
    const style = window.getComputedStyle(banner)
    const marginBottom = Number.parseFloat(style.marginBottom) || 0
    setPromptAnchorTopInset(banner.offsetHeight + marginBottom)
  }, [historyError, loadingEarlier, setPromptAnchorTopInset, showEarlier])

  return (
    <>
      {showEarlier ? (
        <div ref={foldBannerRef} className="transcript-fold-banner" role="status">
          <button type="button" data-ui="chat.show-earlier" className="transcript-fold-toggle"
            disabled={loadingEarlier} aria-busy={loadingEarlier || undefined}
            aria-label={loadingEarlier ? 'Loading earlier messages' : 'Load earlier messages'}
            title={loadingEarlier ? 'Loading earlier messages' : 'Load earlier messages'}
            onClick={() => { void revealEarlier() }}>
            <ChevronUp className="transcript-fold-chevron" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {historyError ? <p className="transcript-history-error" role="alert">{historyError}</p> : null}
      {rows.map((row, index) => {
        const foldedBy = layout.folds.get(index)
        if (foldedBy && !flipped.has(foldedBy)) return null
        const head = layout.heads.get(index)
        const rowElement = renderRow(row, index)
        if (!head) return rowElement
        const open = head.foldable && flipped.has(head.key)
        return [
          rowElement,
          <MessageScrollerItem key={`turn:${head.key}`} messageId={`turn:${head.key}`}>
            <TurnHeader head={head} open={open} onToggle={toggleTurn} />
          </MessageScrollerItem>,
          head.stage && !flipped.has(head.key) ? renderStage(head.key, head.stage) : null
        ]
      })}
    </>
  )

  /**
   * A live turn's stage is one scroller row with two fixed places: the newest commentary on
   * top and the newest step group beneath it. Each place swaps its content in place, so new
   * text and steps never move what is already on screen; only text after the newest step (which
   * may be the answer) is shown at full height.
   */
  function renderStage(key: string, stage: TurnStage): JSX.Element {
    const step = rows[stage.step]
    const text = rows[stage.text]
    const group = step?.kind === 'activity' ? step : null
    const said = text?.kind === 'item' && text.item.type === 'assistant' ? text.item : null
    return (
      <MessageScrollerItem key={`stage:${key}`} messageId={`stage:${key}`}>
        <div className="turn-stage">
          <RollSlot slotKey={said?.id ?? null} className="turn-stage-text" data-open={stage.textOpen || undefined}>
            {said ? <AssistantMessage paneId={paneId} item={said} cwd={cwd} /> : null}
          </RollSlot>
          <RollSlot slotKey={group ? `${group.id}:${group.items[0]?.id}` : null}>
            {group ? (
              <ToolActivity items={group.items} shots={group.shots} staged cwd={cwd}
                isRunning={isActivityRowRunning(group, stage.step, lastTurnIndex, activeTurnId)} />
            ) : null}
          </RollSlot>
          {/* Captures stay outside the rolling step slot so task transitions cannot fade them. */}
          {group?.shots.length ? <ScreenshotStrip shots={group.shots} /> : null}
        </div>
      </MessageScrollerItem>
    )
  }

  function renderRow(row: TranscriptRow, index: number): JSX.Element {
        if (row.kind === 'background') {
          return <MessageScrollerItem key={`background:${row.id}`} messageId={`background:${row.id}`}>
            <BackgroundTasks items={row.items} />
          </MessageScrollerItem>
        }
        if (row.kind === 'activity') {
          const id = `activity:${row.id}:${row.items[0]?.id}`
          const isRunning = isActivityRowRunning(row, index, lastTurnIndex, activeTurnId)
          return (
            <MessageScrollerItem key={id} messageId={id}>
              <ToolActivity items={row.items} shots={row.shots} isRunning={isRunning} cwd={cwd} />
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
            <TranscriptItem paneId={paneId} item={row.item} cwd={cwd} actions={actionMessageIds.has(row.item.id) ? actions : undefined} />
          </MessageScrollerItem>
        )
  }
})

/**
 * The line over a turn's process: "Working for 12s" while it runs, "Worked for 38s" once it
 * settles, over a hairline. A live turn shows only its stage beneath it and a settled turn
 * only its answer; clicking the header opens every step and commentary. The clock starts when the header first mounts, so a live turn
 * counts from its prompt even before the first step reports a time.
 */
const TurnHeader = memo(function TurnHeader({ head, open, onToggle }: {
  head: TurnHead
  open: boolean
  onToggle: (key: string) => void
}): JSX.Element {
  const [mountedAt] = useState(() => Date.now())
  const [settledAt, setSettledAt] = useState<number | null>(null)
  const [wasLive, setWasLive] = useState(head.live)
  if (wasLive !== head.live) {
    setWasLive(head.live)
    setSettledAt(head.live ? null : Date.now())
  }
  const now = useClock(head.live)
  const start = Math.min(head.startedAt ?? Infinity, wasLive || settledAt !== null ? mountedAt : Infinity)
  const end = head.live ? now : settledAt ?? head.endedAt
  const elapsed = Number.isFinite(start) && end !== null && end > start ? elapsedLabel(end - start) : null
  const label = head.live
    ? `Working${elapsed ? ` for ${elapsed}` : ''}`
    : elapsed ? `Worked for ${elapsed}` : `Worked through ${head.steps} ${head.steps === 1 ? 'step' : 'steps'}`
  if (!head.foldable) {
    return <div className="prompt-turn-head" data-live={head.live || undefined} role={head.live ? 'status' : undefined}>{label}</div>
  }
  return (
    <button type="button" className="prompt-turn-head" data-ui="chat.turn-steps" data-ui-key={head.key}
      aria-expanded={open} onClick={() => onToggle(head.key)}>
      <span>{label}</span>
      <ChevronRight className={`prompt-turn-chevron${open ? ' is-open' : ''}`} aria-hidden="true" />
    </button>
  )
})

/** Whole seconds, the way the header reads: "4s", "1m 27s". */
function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

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

/** Consecutive batches can share a turn id; compare members so React does not reuse the wrong group. */
function sameItems<T>(previous: readonly T[], next: readonly T[]): boolean {
  return previous.length === next.length && previous.every((item, index) => item === next[index])
}

const TranscriptItem = memo(function TranscriptItem({
  item,
  actions,
  cwd,
  paneId
}: {
  actions?: MessageActionContext
  item: StandaloneItem
  paneId?: string
  cwd?: string
}): JSX.Element | null {
  if (item.type === 'user') {
    const text = item.text ? displayUserMessageText(item.text) : ''
    return (
      <Message className="message message-user prompt-message prompt-message-user">
        <MessageContent>
          {item.attachments?.length ? <TranscriptAttachments attachments={item.attachments} /> : null}
          {text ? (
            <Bubble variant="secondary">
              <BubbleContent className="prompt-message-user-content">
                <Markdown cwd={cwd}>{text}</Markdown>
              </BubbleContent>
            </Bubble>
          ) : null}
        </MessageContent>
      </Message>
    )
  }
  if (item.type === 'assistant') {
    if (!item.text) return null
    return <AssistantMessage paneId={paneId} item={item} actions={actions} cwd={cwd} />
  }
  if (item.type === 'notice') {
    if (hiddenTranscriptNotice(item)) return null
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
  shots,
  isRunning,
  staged = false,
  cwd
}: {
  items: ActivityItem[]
  shots: ScreenshotItem[]
  isRunning?: boolean
  /** In a live turn's stage: always the newest step's line, so the shape never flips mid-turn. */
  staged?: boolean
  cwd?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [opened, setOpened] = useState(false)
  const state = useMemo(() => activityState(items), [items])
  const running = isRunning ?? (state === 'running')
  const headline = useMemo(() => activityHeadline(items, running), [items, running])
  const lines = useMemo(() => {
    const counts = diffCounts(items.flatMap((item) => item.type === 'fileChange' ? item.changes : []))
    return counts.added || counts.removed ? counts : null
  }, [items])
  // A group that mounts mid-turn rolls its counts up from zero as edits land; a settled one
  // (history, a reopened chat) paints its totals at once.
  const [rollFromZero] = useState(running)
  const failed = state === 'failed'
  const status = running ? 'running' : failed ? 'failed' : 'completed'
  const linesLabel = lines ? `, ${lines.added} lines added, ${lines.removed} removed` : ''
  // While running, the line is the step under way; once settled it is the counted headline,
  // led by the icon of what the group mostly did (an edit when there was one).
  const now = useClock(running)
  const current = useMemo(() => (running || staged ? activitySteps(items, now).at(-1) ?? null : null), [items, now, running, staged])
  const lead = items.find((item) => item.type === 'fileChange') ?? items[0]
  return (
    <div className="prompt-tool-activity" data-state={state} data-live={running || undefined} data-lead={lead?.type}>
      <Collapsible open={open} onOpenChange={(next) => { if (next) setOpened(true); setOpen(next) }}>
        <div className="prompt-tool-activity-head">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="prompt-tool-activity-trigger"
              aria-label={`${headline}${linesLabel}, ${status}`}
            >
              {current ? <LiveLine key={current.id} step={current} /> : (
                <>
                  {failed && open
                    ? <XCircle className="prompt-process-failed" aria-hidden="true" />
                    : lead ? <KindIcon kind={lead.type} className="prompt-tool-activity-icon" /> : null}
                  <span>{headline}</span>
                </>
              )}
              <ChevronRight className={`size-3 prompt-process-chevron transition-transform duration-150 ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
            </button>
          </CollapsibleTrigger>
          {lines ? (
            <span className="prompt-tool-activity-lines" aria-hidden="true">
              <span className="diff-stat-add">+<NumberTicker value={lines.added} startValue={rollFromZero ? 0 : undefined} /></span>
              <span className="diff-stat-del">−<NumberTicker value={lines.removed} startValue={rollFromZero ? 0 : undefined} /></span>
            </span>
          ) : null}
        </div>
        {opened ? (
          <CollapsibleContent className="prompt-tool-activity-content">
            <div className="prompt-tool-activity-card">
              <ActivitySteps items={items} cwd={cwd} />
            </div>
          </CollapsibleContent>
        ) : null}
        {!staged && shots.length ? <ScreenshotStrip shots={shots} /> : null}
      </Collapsible>
    </div>
  )
}, (prev, next) => sameItems(prev.items, next.items) && sameItems(prev.shots, next.shots)
  && prev.isRunning === next.isRunning && prev.staged === next.staged && prev.cwd === next.cwd)

const AssistantMessage = memo(function AssistantMessage({ item, actions, cwd, paneId }: {
  item: Extract<ChatTranscriptItem, { type: 'assistant' }>
  paneId?: string
  actions?: MessageActionContext
  cwd?: string
}): JSX.Element | null {
  // The displayed text trails what has streamed in by a bounded catch-up window, so one-token,
  // sentence-burst, and whole-message chunk cadences all paint as the same typewriter. Settled
  // items render in full immediately; the drain also finishes turns that never settle their item.
  const { settings } = usePerformanceSettings()
  const text = usePacedText(item.text, !item.streaming, settings.instantStreaming)
  const paintRef = useResponsePaint(paneId, item.turnId, Boolean(text.trim()))
  const streaming = Boolean(item.streaming) || text.length < item.text.length
  if (!text) return null
  return (
    <Message ref={paintRef} className="message message-assistant prompt-message prompt-message-assistant" data-phase={item.phase ?? 'unknown'}>
      <MessageContent>
        <Bubble variant="ghost">
          <BubbleContent className="prompt-message-assistant-content prose max-w-none dark:prose-invert">
            <Markdown streaming={streaming} cwd={cwd}>{text}</Markdown>
          </BubbleContent>
        </Bubble>
        {actions ? <MessageActions key={actions.threadKey + item.id} item={item} context={actions} /> : null}
      </MessageContent>
    </Message>
  )
})
