import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { LocateFixed, LockKeyhole, Minus, Plus } from 'lucide-react'

import { relative } from './project-time.js'
import { NODE_HEIGHT, NODE_WIDTH, type PlacedNode, type TreeLayout } from './project-tree.js'

type View = { x: number; y: number; scale: number }

const MIN_SCALE = 0.5
const MAX_SCALE = 1.5
const DEFAULT_SCALE = 0.92
const TOP_INSET = 34
const CLICK_SLOP = 4

const clampScale = (scale: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))

function edgePath(parent: PlacedNode, child: PlacedNode): string {
  const startX = parent.x + NODE_WIDTH / 2
  const startY = parent.y + NODE_HEIGHT
  const endX = child.x + NODE_WIDTH / 2
  const endY = child.y
  const bend = Math.max(24, (endY - startY) * 0.55)
  return `M ${startX} ${startY} C ${startX} ${startY + bend}, ${endX} ${endY - bend}, ${endX} ${endY}`
}

/** Zoom about a point in pane pixels, keeping that point fixed on screen. */
function zoomAt(view: View, nextScale: number, px: number, py: number): View {
  const scale = clampScale(nextScale)
  return {
    scale,
    x: px - ((px - view.x) / view.scale) * scale,
    y: py - ((py - view.y) / view.scale) * scale
  }
}

export function ProjectCanvas(props: {
  layout: TreeLayout
  selectedId: string | null
  /** Nodes that changed while the user was away from the map; they pulse until looked at. */
  changedIds?: ReadonlySet<string>
  now: number
  onSelect: (id: string | null) => void
}) {
  const { layout, selectedId, changedIds, now, onSelect } = props
  const pane = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: TOP_INSET, scale: DEFAULT_SCALE })
  // Once the user pans or zooms, the canvas stops following the growing tree.
  const touched = useRef(false)
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null)

  /** Root at top centre, zoomed out just enough for the whole width to fit the pane. */
  const centred = (): View => {
    const width = pane.current?.clientWidth ?? 0
    const scale = clampScale(Math.min(DEFAULT_SCALE, (width - 2 * TOP_INSET) / layout.width))
    return { x: (width - layout.width * scale) / 2, y: TOP_INSET, scale }
  }

  useLayoutEffect(() => {
    if (!touched.current) setView(centred())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the root while the tree widens
  }, [layout.width])

  useEffect(() => {
    const element = pane.current
    if (!element) return
    // React registers onWheel passively, so preventing page scroll needs a native listener.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      touched.current = true
      const bounds = element.getBoundingClientRect()
      setView((current) => zoomAt(current, current.scale * (event.deltaY > 0 ? 0.92 : 1.08),
        event.clientX - bounds.left, event.clientY - bounds.top))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  function zoomBy(delta: number): void {
    touched.current = true
    const element = pane.current
    setView((current) => zoomAt(current, current.scale + delta,
      (element?.clientWidth ?? 0) / 2, (element?.clientHeight ?? 0) / 2))
  }

  function recenter(): void {
    touched.current = false
    setView(centred())
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>): void {
    if ((event.target as HTMLElement).closest('button, a')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      originX: view.x, originY: view.y, moved: false
    }
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>): void {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (!current.moved && Math.hypot(dx, dy) < CLICK_SLOP) return
    current.moved = true
    touched.current = true
    setView((state) => ({ ...state, x: current.originX + dx, y: current.originY + dy }))
  }

  function pointerUp(): void {
    if (drag.current && !drag.current.moved) onSelect(null)
    drag.current = null
  }

  const byId = new Map(layout.nodes.map((node) => [node.id, node]))
  const scopes = layout.nodes.filter((node) => node.kind === 'scope').length
  const active = layout.nodes.filter((node) => node.state === 'active').length

  return <div className="project-canvas" ref={pane}
    onPointerDown={pointerDown}
    onPointerMove={pointerMove}
    onPointerUp={pointerUp}
    onPointerCancel={() => { drag.current = null }}>
    <div className="project-canvas-meta">
      <strong>Direction map</strong>
      <span>{scopes ? `${scopes} scopes · ${active} active` : 'Root coordinator starting'}</span>
    </div>

    <div className="project-canvas-world"
      style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
      <svg className="project-tree-edges" width={layout.width} height={layout.height} aria-hidden="true">
        {layout.nodes.flatMap((node) => {
          const parent = node.parent ? byId.get(node.parent) : null
          return parent
            ? <path key={node.id} d={edgePath(parent, node)} data-active={node.state === 'active' || undefined} />
            : []
        })}
      </svg>
      {layout.nodes.map((node) => <button key={node.id} type="button"
        className={`project-tree-node is-${node.kind}`}
        style={{ left: node.x, top: node.y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
        data-state={node.state}
        data-selected={selectedId === node.id || undefined}
        data-changed={changedIds?.has(node.id) || undefined}
        data-ui="preview.project-node"
        data-ui-key={node.id}
        onClick={() => onSelect(selectedId === node.id ? null : node.id)}>
        <span className="project-tree-node-heading">
          {node.kind === 'root' && <LockKeyhole size={12} aria-hidden="true" />}
          <strong>{node.title}</strong>
          <time dateTime={new Date(node.updatedAt).toISOString()}>{relative(node.updatedAt, now)}</time>
        </span>
        <small>{node.summary}</small>
      </button>)}
    </div>

    <div className="project-canvas-controls" aria-label="Canvas controls">
      <button type="button" aria-label="Zoom out" data-ui="preview.project-canvas-zoom" data-ui-key="out"
        onClick={() => zoomBy(-0.12)}><Minus size={14} /></button>
      <span>{Math.round(view.scale * 100)}%</span>
      <button type="button" aria-label="Zoom in" data-ui="preview.project-canvas-zoom" data-ui-key="in"
        onClick={() => zoomBy(0.12)}><Plus size={14} /></button>
      <button type="button" aria-label="Recenter on the root coordinator" data-ui="preview.project-canvas-reset"
        onClick={recenter}><LocateFixed size={14} /></button>
    </div>
  </div>
}
