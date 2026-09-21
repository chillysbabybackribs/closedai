import { useEffect, useRef } from 'react'
import { CircleAlert, LoaderCircle, Pause, X } from 'lucide-react'
import type { TabActivity } from './tab-activity.js'
import { tabCloseHint } from './layout-copy.js'
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
    // The strip hides its scrollbar; a plain wheel over it pans the tabs instead of doing nothing.
    onWheel={(event) => {
      const strip = event.currentTarget
      if (event.deltaX || !event.deltaY || strip.scrollWidth <= strip.clientWidth) return
      strip.scrollLeft += event.deltaY
    }}>
    {ids.map((id, index) => {
      const status = activity?.(id)
      const closeHint = tabCloseHint(status?.state)
      return <div key={id} className="chat-layout-tab" data-active={id === activeId} data-status={status?.state} role="presentation">
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
        // The header's context menu belongs to the active conversation; selection is async, so a
        // right-click on another tab activates it without opening the wrong conversation's menu.
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
        {status && status.state !== 'idle' && <span className="chat-tab-indicator" aria-hidden="true">
          {status.state === 'working' ? <LoaderCircle className="chat-tab-spinner" size={16} />
            : status.state === 'paused' ? <Pause size={16} />
              : status.state === 'failed' ? <CircleAlert size={16} />
                : <i className="chat-tab-unread" />}
        </span>}
        <span>{title(id)}</span></button>
      {canClose && <button type="button" className="chat-layout-tab-close" data-ui="layout.tab-close" data-ui-key={id}
        // Inactive tabs keep their close out of the tab order; Delete on the focused tab closes it.
        tabIndex={id === activeId ? 0 : -1}
        disabled={busy} aria-label={`Close tab: ${title(id)} · ${closeHint}${id === activeId ? ' · Delete' : ''}`} title={`Close tab · ${closeHint}`}
        onClick={() => onClose(id)}><X size={11} aria-hidden="true" /></button>}
    </div>})}
  </div>
}
