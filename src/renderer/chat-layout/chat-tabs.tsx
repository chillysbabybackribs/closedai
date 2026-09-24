import { useEffect, useRef, type RefObject } from 'react'
import { CircleAlert, LoaderCircle, Pause, X } from 'lucide-react'
import type { ChatReviewQueue } from '../chat-history/review-queue.js'
import type { TabActivity } from './tab-activity.js'
import { tabCloseHint } from './layout-copy.js'
import { CHAT_DRAG_TYPE, isViewTabId } from './layout-tree.js'
import { CHAT_TAB_DRAG_TYPE } from './layout-tabs.js'
import { viewKindOf, type ViewKind } from './layout-views.js'
import { VIEW_ICONS } from './pane-add-menu.js'
import { usePaneTabActivity } from './chat-pane-tab-activity.js'

export function ChatTabs({ ids, activeId, busy, canClose, title, activity, reviewQueue, onSelect, onClose, onDrag }: {
  ids: string[]
  activeId: string
  busy: boolean
  canClose: boolean
  title: (id: string) => string
  activity?: (id: string) => TabActivity
  reviewQueue?: ChatReviewQueue
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onDrag: (id: string) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = list.current
    const active = container?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!container || !active) return
    const tabLeft = active.offsetLeft
    const tabRight = tabLeft + active.offsetWidth
    const viewLeft = container.scrollLeft
    const viewRight = viewLeft + container.clientWidth

    if (tabLeft < viewLeft) {
      container.scrollTo({ left: Math.max(0, tabLeft - 16), behavior: 'smooth' })
    } else if (tabRight > viewRight) {
      container.scrollTo({ left: tabRight - container.clientWidth + 16, behavior: 'smooth' })
    }
  }, [activeId, ids.length])

  return <div ref={list} className="chat-layout-tabs" role="tablist" aria-label="Chat conversations"
    onWheel={(event) => {
      const strip = event.currentTarget
      if (event.deltaX || !event.deltaY || strip.scrollWidth <= strip.clientWidth) return
      strip.scrollLeft += event.deltaY
    }}>
    {ids.map((id, index) => reviewQueue && !isViewTabId(id)
      ? <ChatTabRowLive key={id} id={id} index={index} ids={ids} activeId={activeId} busy={busy} canClose={canClose}
          title={title} reviewQueue={reviewQueue} list={list} onSelect={onSelect} onClose={onClose} onDrag={onDrag} />
      : <ChatTabRow key={id} id={id} index={index} ids={ids} activeId={activeId} busy={busy} canClose={canClose}
          title={title} activity={activity} list={list} onSelect={onSelect} onClose={onClose} onDrag={onDrag} />)}
  </div>
}

/** A view tab shows its kind where a chat tab shows status: never a spinner, never unread. */
function ViewTabGlyph({ kind }: { kind: ViewKind }) {
  return <span className="chat-tab-indicator" aria-hidden="true">{VIEW_ICONS[kind]({ size: 13 })}</span>
}

function TabStatusIndicator({ status }: { status: TabActivity | undefined }) {
  if (!status || status.state === 'idle') return null
  return <span className="chat-tab-indicator" aria-hidden="true">
    {status.state === 'working' ? <LoaderCircle className="chat-tab-spinner" size={16} />
      : status.state === 'paused' ? <Pause size={16} />
        : status.state === 'failed' ? <CircleAlert size={16} />
          : <i className="chat-tab-unread" />}
  </span>
}

function ChatTabRowLive(props: Omit<ChatTabRowProps, 'activity'> & { reviewQueue: ChatReviewQueue }) {
  const status = usePaneTabActivity(props.id, props.reviewQueue)
  return <ChatTabRowBody {...props} status={status} />
}

function ChatTabRow(props: ChatTabRowProps) {
  const status = isViewTabId(props.id) ? undefined : props.activity?.(props.id)
  return <ChatTabRowBody {...props} status={status} />
}

type ChatTabRowProps = {
  id: string
  index: number
  ids: string[]
  activeId: string
  busy: boolean
  canClose: boolean
  title: (id: string) => string
  activity?: (id: string) => TabActivity
  list: RefObject<HTMLDivElement | null>
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onDrag: (id: string) => void
}

function ChatTabRowBody({ id, index, ids, activeId, busy, canClose, title, status, list, onSelect, onClose, onDrag }: ChatTabRowProps & {
  status: TabActivity | undefined
}) {
  const viewKind = viewKindOf(id)
  const closeHint = viewKind ? 'Chats stay open' : tabCloseHint(status?.state)
  return <div className="chat-layout-tab" data-active={id === activeId} data-status={status?.state} data-kind={viewKind ?? undefined} role="presentation">
    <button type="button" role="tab" data-ui="layout.tab" data-ui-key={id}
      id={`chat-tab-${id}`} aria-controls={`chat-panel-${id}`} aria-selected={id === activeId}
      tabIndex={id === activeId ? 0 : -1} disabled={busy} draggable={!busy}
      title={id === activeId ? `${title(id)} — Drag to move, right-click for layout options` : `${title(id)} — Click to activate, drag to move`}
      aria-label={`${title(id)}${status ? ` — ${status.label}` : ''}`}
      onDragStart={(event) => {
        event.dataTransfer.setData(CHAT_DRAG_TYPE, id)
        event.dataTransfer.setData(CHAT_TAB_DRAG_TYPE, id)
        event.dataTransfer.effectAllowed = 'move'
        onDrag(id)
      }}
      onClick={() => onSelect(id)}
      onContextMenu={(event) => { if (id !== activeId) { event.preventDefault(); onSelect(id) } }}
      onKeyDown={(event) => {
        if (event.key === 'Delete' && canClose && !busy) {
          event.preventDefault()
          onClose(id)
          return
        }
        const next = event.key === 'ArrowRight' ? (index + 1) % ids.length
          : event.key === 'ArrowLeft' ? (index + ids.length - 1) % ids.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : null
        if (next === null) return
        event.preventDefault()
        list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
        onSelect(ids[next]!)
      }}>
      {viewKind ? <ViewTabGlyph kind={viewKind} /> : <TabStatusIndicator status={status} />}
      <span>{title(id)}</span></button>
    {canClose && <button type="button" className="chat-layout-tab-close" data-ui="layout.tab-close" data-ui-key={id}
      tabIndex={id === activeId ? 0 : -1}
      disabled={busy} aria-label={`Close ${viewKind ? 'view' : 'tab'}: ${title(id)} · ${closeHint}`} title={`Close ${viewKind ? 'view' : 'tab'} · ${closeHint}`}
      onClick={() => onClose(id)}><X size={11} aria-hidden="true" /></button>}
  </div>
}
