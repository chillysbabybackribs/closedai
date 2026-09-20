import { useEffect, useRef } from 'react'
import { CircleAlert, LoaderCircle, Pause, X } from 'lucide-react'
import { Tooltip } from 'radix-ui'
import { TabActivityPreview } from './tab-activity-preview.js'
import type { TabActivity } from './tab-activity.js'
import { CHAT_DRAG_TYPE } from './layout-tree.js'
import { CHAT_TAB_DRAG_TYPE } from './layout-tabs.js'

export function ChatTabs({ ids, activeId, busy, canClose, title, activity, onSelect, onClose, onDrag }: {
  ids: string[]
  activeId: string
  busy: boolean
  canClose: boolean
  title: (id: string) => string
  activity?: (id: string) => TabActivity
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onDrag: (id: string) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const active = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (active) list.current!.scrollLeft = Math.max(0, active.offsetLeft - list.current!.clientWidth + active.offsetWidth)
  }, [activeId, ids.length])

  return <Tooltip.Provider delayDuration={450}><div ref={list} className="chat-layout-tabs" role="tablist" aria-label="Chat conversations">
    {ids.map((id, index) => {
      const status = activity?.(id)
      return <div key={id} className="chat-layout-tab" data-active={id === activeId} data-status={status?.state} role="presentation">
      <Tooltip.Root><Tooltip.Trigger asChild>
      <button type="button" role="tab" data-ui="layout.tab" data-ui-key={id}
        id={`chat-tab-${id}`} aria-controls={`chat-panel-${id}`} aria-selected={id === activeId}
        tabIndex={id === activeId ? 0 : -1} disabled={busy} draggable={!busy}
        aria-label={`${title(id)}${status ? ` — ${status.label}` : ''}`}
        onDragStart={(event) => {
          event.dataTransfer.setData(CHAT_DRAG_TYPE, id)
          event.dataTransfer.setData(CHAT_TAB_DRAG_TYPE, id)
          event.dataTransfer.effectAllowed = 'move'
          onDrag(id)
        }}
        onClick={() => onSelect(id)}
        // The header's context menu belongs to the active conversation; selection is async, so a
        // right-click on another tab activates it without opening the wrong conversation's menu.
        onContextMenu={(event) => { if (id !== activeId) { event.preventDefault(); onSelect(id) } }}
        onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? (index + 1) % ids.length
            : event.key === 'ArrowLeft' ? (index + ids.length - 1) % ids.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : null
          if (next === null) return
          event.preventDefault()
          list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
          onSelect(ids[next]!)
        }}>
        {status && status.state !== 'idle' && <span className="chat-tab-indicator" aria-hidden="true">
          {status.state === 'working' ? <LoaderCircle className="chat-tab-spinner" size={12} />
            : status.state === 'paused' ? <Pause size={12} />
              : status.state === 'failed' ? <CircleAlert size={12} />
                : <i className="chat-tab-unread" />}
        </span>}
        <span>{title(id)}</span></button>
      </Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="chat-tab-preview" side="bottom" align="start" sideOffset={8}
        collisionBoundary={list.current?.closest('.chat-layout-tile') ?? undefined} collisionPadding={8}>
        <TabActivityPreview title={title(id)} activity={status} />
      </Tooltip.Content></Tooltip.Portal></Tooltip.Root>
      {canClose && <button type="button" className="chat-layout-tab-close" data-ui="layout.tab-close" data-ui-key={id}
        disabled={busy} aria-label={`Close tab: ${title(id)}`} title="Close tab; keep chat in history"
        onClick={() => onClose(id)}><X size={11} aria-hidden="true" /></button>}
    </div>})}
  </div></Tooltip.Provider>
}
