import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export function ChatTabs({ ids, activeId, busy, canClose, title, onSelect, onClose }: {
  ids: string[]
  activeId: string
  busy: boolean
  canClose: boolean
  title: (id: string) => string
  onSelect: (id: string) => void
  onClose: (id: string) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const active = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (active) list.current!.scrollLeft = Math.max(0, active.offsetLeft - list.current!.clientWidth + active.offsetWidth)
  }, [activeId, ids.length])

  return <div ref={list} className="chat-layout-tabs" role="tablist" aria-label="Chat conversations">
    {ids.map((id, index) => <div key={id} className="chat-layout-tab" data-active={id === activeId} role="presentation">
      <button type="button" role="tab" data-ui="layout.tab" data-ui-key={id}
        id={`chat-tab-${id}`} aria-controls={`chat-panel-${id}`} aria-selected={id === activeId}
        tabIndex={id === activeId ? 0 : -1} disabled={busy} title={title(id)}
        onClick={() => onSelect(id)} onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? (index + 1) % ids.length
            : event.key === 'ArrowLeft' ? (index + ids.length - 1) % ids.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : null
          if (next === null) return
          event.preventDefault()
          list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
          onSelect(ids[next]!)
        }}><span>{title(id)}</span></button>
      {canClose && <button type="button" className="chat-layout-tab-close" data-ui="layout.tab-close" data-ui-key={id}
        disabled={busy} aria-label={`Close tab: ${title(id)}`} title="Close tab; keep chat in history"
        onClick={() => onClose(id)}><X size={11} aria-hidden="true" /></button>}
    </div>)}
  </div>
}
