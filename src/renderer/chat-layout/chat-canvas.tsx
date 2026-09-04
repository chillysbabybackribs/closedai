import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Columns2, GripVertical, Rows2, X } from 'lucide-react'
import { CHAT_DRAG_TYPE, layoutGeometry, minimumSize, type ChatLayout, type DockEdge, type Rect } from './layout-tree.js'

const position = (rect: Rect): CSSProperties => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })

export function ChatCanvas({ tree, selectedId, busy, title, renderPane, onSelect, onDock, onHide, onResize }: {
  tree: ChatLayout
  selectedId: string
  busy: boolean
  title: (id: string) => string
  renderPane: (id: string) => ReactNode
  onSelect: (id: string) => void
  onDock: (id: string | null, target: string, edge: DockEdge) => void
  onHide: (id: string) => void
  onResize: (id: string, ratio: number) => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ target: string; edge: DockEdge } | null>(null)
  const dropTarget = useRef<typeof drop>(null)
  const resize = useRef<{ id: string; start: number; ratio: number; length: number; axis: string; min: number; max: number } | null>(null)
  useEffect(() => {
    const host = viewport.current!
    const observer = new ResizeObserver(() => setSize({ width: host.clientWidth, height: host.clientHeight }))
    observer.observe(host)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const clear = (): void => { setDragging(null); setDrop(null); dropTarget.current = null }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => { window.removeEventListener('dragend', clear); window.removeEventListener('drop', clear) }
  }, [])
  const geometry = layoutGeometry(tree, size.width, size.height)
  const minimum = minimumSize(tree)

  return <div className="chat-layout-viewport" ref={viewport}>
    <div className="chat-layout-canvas" style={{ minWidth: minimum.width, minHeight: minimum.height }}>
      {geometry.panes.map(({ id, rect }) => <section key={id}
        className="chat-layout-tile" style={position(rect)} data-pane-id={id}
        data-selected={id === selectedId} aria-label={title(id)}
        onFocusCapture={() => { if (id !== selectedId) onSelect(id) }}
        onPointerDownCapture={() => { if (id !== selectedId) onSelect(id) }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(CHAT_DRAG_TYPE)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          const bounds = event.currentTarget.getBoundingClientRect()
          const x = (event.clientX - bounds.left) / bounds.width
          const y = (event.clientY - bounds.top) / bounds.height
          const edges: Array<[DockEdge, number]> = [['left', x], ['right', 1 - x], ['top', y], ['bottom', 1 - y]]
          const edge = edges.sort((a, b) => a[1] - b[1])[0]![0]
          dropTarget.current = { target: id, edge }
          setDrop(dropTarget.current)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            dropTarget.current = null
            setDrop(null)
          }
        }}
        onDrop={(event) => {
          const source = event.dataTransfer.getData(CHAT_DRAG_TYPE)
          const target = dropTarget.current
          if (!source || !target || target.target !== id) return
          event.preventDefault()
          event.stopPropagation()
          onDock(source, id, target.edge)
          dropTarget.current = null
          setDragging(null)
          setDrop(null)
        }}>
        <header className="chat-layout-header">
          <button className="chat-layout-title" draggable={!busy} data-ui="layout.pane-drag" data-ui-key={id}
            title="Drag to move this chat to the left, right, above, or below another chat"
            onClick={() => onSelect(id)}
            onDragStart={(event) => {
              event.dataTransfer.setData(CHAT_DRAG_TYPE, id)
              event.dataTransfer.effectAllowed = 'move'
              setDragging(id)
            }}>
            <GripVertical size={13} aria-hidden="true" /><span>{title(id)}</span>
          </button>
          <button data-ui="layout.split-right" data-ui-key={id} disabled={busy}
            title="New chat to the right" aria-label="New chat to the right" onClick={() => onDock(null, id, 'right')}>
            <Columns2 size={14} aria-hidden="true" />
          </button>
          <button data-ui="layout.split-below" data-ui-key={id} disabled={busy}
            title="New chat below" aria-label="New chat below" onClick={() => onDock(null, id, 'bottom')}>
            <Rows2 size={14} aria-hidden="true" />
          </button>
          <button data-ui="layout.pane-hide" data-ui-key={id} disabled={busy || geometry.panes.length < 2}
            title="Hide this pane; its chat keeps running" aria-label="Hide chat pane" onClick={() => onHide(id)}>
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        <div className="chat-layout-content">{renderPane(id)}</div>
        {drop?.target === id && dragging !== id && <div className="chat-layout-drop" data-edge={drop.edge}>
          <span>{drop.edge === 'top' ? 'Place above' : drop.edge === 'bottom' ? 'Place below' : `Place ${drop.edge}`}</span>
        </div>}
      </section>)}
      {geometry.dividers.map((divider) => <div key={divider.id} className="chat-layout-divider"
        style={position(divider.rect)} data-axis={divider.axis} role="separator" tabIndex={0}
        data-ui="layout.divider" data-ui-key={divider.id}
        aria-label="Resize chat panes" aria-orientation={divider.axis === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(divider.ratio * 100)} aria-valuemin={Math.round(divider.min * 100)} aria-valuemax={Math.round(divider.max * 100)}
        onDoubleClick={() => onResize(divider.id, 0.5)}
        onKeyDown={(event) => {
          const keys = divider.axis === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
          if (!keys.includes(event.key)) return
          event.preventDefault()
          const ratio = divider.ratio + (event.key === keys[0] ? -0.05 : 0.05)
          onResize(divider.id, Math.max(divider.min, Math.min(divider.max, ratio)))
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          resize.current = { id: divider.id, start: divider.axis === 'horizontal' ? event.clientX : event.clientY,
            ratio: divider.ratio, length: (divider.axis === 'horizontal' ? divider.parent.width : divider.parent.height) - 5,
            axis: divider.axis, min: divider.min, max: divider.max }
        }}
        onPointerMove={(event) => {
          const active = resize.current
          if (!active || active.id !== divider.id) return
          const delta = (active.axis === 'horizontal' ? event.clientX : event.clientY) - active.start
          onResize(active.id, Math.max(active.min, Math.min(active.max, active.ratio + delta / active.length)))
        }}
        onPointerUp={() => { resize.current = null }}
        onLostPointerCapture={() => { resize.current = null }}
      />)}
    </div>
  </div>
}
