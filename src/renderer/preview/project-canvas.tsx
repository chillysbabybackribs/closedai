import { useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { ExternalLink, LocateFixed, LockKeyhole, Minus, Plus } from 'lucide-react'

type TreeNode = {
  id: string
  parent?: string
  x: number
  y: number
  title: string
  kind: 'origin' | 'direction' | 'outcome' | 'research' | 'work'
  state: 'anchored' | 'confirmed' | 'provisional' | 'active' | 'complete'
  summary: string
  detail: string
  links?: Array<{ label: string; url: string }>
}

const NODE_WIDTH = 190
const NODE_HEIGHT = 58
const INITIAL_VIEW = { x: 28, y: 18, scale: 0.86 }

const BASE_NODES: TreeNode[] = [
  {
    id: 'origin', x: 64, y: 282, title: 'Original idea', kind: 'origin', state: 'anchored',
    summary: 'The user’s confirmed starting words.',
    detail: 'This remains immutable. New direction is recorded as an amendment, so later work can always be traced back to what the user originally meant.'
  },
  {
    id: 'direction', parent: 'origin', x: 326, y: 282, title: 'Current direction',
    kind: 'direction', state: 'confirmed', summary: 'The coordinator’s shared understanding.',
    detail: 'A living synthesis of the intended outcome, primary user, central journey, constraints, and quality bar confirmed during discovery.'
  },
  {
    id: 'outcome', parent: 'direction', x: 594, y: 76, title: 'Primary outcome',
    kind: 'outcome', state: 'confirmed', summary: 'The result the project must create.',
    detail: 'Every workstream must be able to explain how its current work advances this outcome. Work without that path is paused or removed.'
  },
  {
    id: 'principles', parent: 'direction', x: 594, y: 188, title: 'Experience principles',
    kind: 'outcome', state: 'provisional', summary: 'What the product should feel like.',
    detail: 'The coordinator extracted these principles from the conversation. They remain provisional until working software validates them.'
  },
  {
    id: 'discovery', parent: 'direction', x: 594, y: 334, title: 'Discovery',
    kind: 'research', state: 'active', summary: 'Questions being resolved with evidence.',
    detail: 'Research is organized around decisions, not collected as a disconnected reading list. Findings become evidence for or against a direction.'
  },
  {
    id: 'build', parent: 'direction', x: 594, y: 500, title: 'Build',
    kind: 'work', state: 'active', summary: 'Runnable work tied to the intended outcome.',
    detail: 'Implementation proceeds while discovery continues. Each branch reports results and can revise its plan without silently changing the root intent.'
  },
  {
    id: 'coordination-research', parent: 'discovery', x: 866, y: 286, title: 'Coordination patterns',
    kind: 'research', state: 'confirmed', summary: '3 sources · conclusion recorded',
    detail: 'Large systems stay intelligible by aggregating work around outcomes and decisions instead of exposing every worker as a first-class object.',
    links: [
      { label: 'OpenAI · Harness engineering', url: 'https://openai.com/index/harness-engineering/' },
      { label: 'Anthropic · Multi-agent research', url: 'https://www.anthropic.com/engineering/multi-agent-research-system' },
      { label: 'Cursor · Projects', url: 'https://cursor.com/blog/projects' }
    ]
  },
  {
    id: 'drift-question', parent: 'discovery', x: 866, y: 390, title: 'Preventing direction drift',
    kind: 'research', state: 'active', summary: 'Evidence review in progress',
    detail: 'The working hypothesis is that immutable origin, explicit amendments, and traceable decisions are stronger controls than repeatedly injecting a long specification.'
  },
  {
    id: 'shell-work', parent: 'build', x: 866, y: 486, title: 'Project shell',
    kind: 'work', state: 'complete', summary: 'Initial conversation and clarity gate',
    detail: 'The familiar composer and focused coordinator conversation establish a clear direction before autonomous work begins.'
  },
  {
    id: 'canvas-work', parent: 'build', x: 866, y: 566, title: 'Intent canvas',
    kind: 'work', state: 'active', summary: 'Current working slice',
    detail: 'This view keeps intent, evidence, decisions, and active work in one progressively disclosed tree without turning the project into a wall of status cards.'
  }
]

function edgePath(parent: TreeNode, child: TreeNode): string {
  const startX = parent.x + NODE_WIDTH
  const startY = parent.y + NODE_HEIGHT / 2
  const endX = child.x
  const endY = child.y + NODE_HEIGHT / 2
  const bend = Math.max(54, (endX - startX) * 0.48)
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`
}

export function ProjectCanvas({ originalIdea, amendment }: { originalIdea: string; amendment: string | null }) {
  const [view, setView] = useState(INITIAL_VIEW)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null)

  const nodes = useMemo(() => {
    const origin = BASE_NODES.map((node) => node.id === 'origin'
      ? { ...node, detail: originalIdea || node.detail }
      : node)
    if (!amendment) return origin
    return [...origin, {
      id: 'amendment', parent: 'direction', x: 326, y: 420, title: 'User amendment',
      kind: 'direction' as const, state: 'confirmed' as const,
      summary: 'New direction added from the canvas.',
      detail: amendment
    }]
  }, [amendment, originalIdea])
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const selected = selectedId ? byId.get(selectedId) ?? null : null

  function zoom(next: number): void {
    setView((current) => ({ ...current, scale: Math.max(0.55, Math.min(1.45, next)) }))
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>): void {
    if ((event.target as HTMLElement).closest('button, a')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      originX: view.x, originY: view.y
    }
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    setView((current) => ({
      ...current,
      x: drag.current!.originX + event.clientX - drag.current!.x,
      y: drag.current!.originY + event.clientY - drag.current!.y
    }))
  }

  function wheel(event: WheelEvent<HTMLDivElement>): void {
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const nextScale = Math.max(0.55, Math.min(1.45, view.scale * (event.deltaY > 0 ? 0.92 : 1.08)))
    const localX = event.clientX - bounds.left
    const localY = event.clientY - bounds.top
    setView({
      scale: nextScale,
      x: localX - ((localX - view.x) / view.scale) * nextScale,
      y: localY - ((localY - view.y) / view.scale) * nextScale
    })
  }

  return <div className="project-canvas"
    onPointerDown={pointerDown}
    onPointerMove={pointerMove}
    onPointerUp={() => { drag.current = null }}
    onPointerCancel={() => { drag.current = null }}
    onWheel={wheel}>
    <div className="project-canvas-meta">
      <strong>Direction map</strong>
      <span>3 research threads · 2 active workstreams</span>
    </div>

    <div className="project-canvas-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
      <svg className="project-tree-edges" width="1160" height="690" viewBox="0 0 1160 690" aria-hidden="true">
        {nodes.flatMap((node) => {
          const parent = node.parent ? byId.get(node.parent) : null
          return parent ? <path key={node.id} d={edgePath(parent, node)} data-active={node.state === 'active' || undefined} /> : []
        })}
      </svg>
      {nodes.map((node) => <button key={node.id} type="button"
        className={`project-tree-node is-${node.kind}`}
        style={{ left: node.x, top: node.y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
        data-state={node.state}
        data-selected={selectedId === node.id || undefined}
        data-ui="preview.project-node"
        data-ui-key={node.id}
        onClick={() => setSelectedId((current) => current === node.id ? null : node.id)}>
        <span className="project-tree-node-heading">
          {node.kind === 'origin' && <LockKeyhole size={12} aria-hidden="true" />}
          <strong>{node.title}</strong>
        </span>
        <small>{node.summary}</small>
      </button>)}
    </div>

    {selected && <aside className="project-node-inspector" aria-live="polite">
      <div className="project-node-inspector-heading">
        <span data-state={selected.state}>{selected.state}</span>
        <strong>{selected.title}</strong>
      </div>
      <p>{selected.detail}</p>
      {selected.links && <div className="project-node-sources">
        <span>Evidence</span>
        {selected.links.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer"
          data-ui="preview.project-source" data-ui-key={link.url}>
          {link.label}<ExternalLink size={11} aria-hidden="true" />
        </a>)}
      </div>}
    </aside>}

    <div className="project-canvas-controls" aria-label="Canvas controls">
      <button type="button" aria-label="Zoom out" data-ui="preview.project-canvas-zoom" data-ui-key="out"
        onClick={() => zoom(view.scale - 0.12)}><Minus size={14} /></button>
      <span>{Math.round(view.scale * 100)}%</span>
      <button type="button" aria-label="Zoom in" data-ui="preview.project-canvas-zoom" data-ui-key="in"
        onClick={() => zoom(view.scale + 0.12)}><Plus size={14} /></button>
      <button type="button" aria-label="Recenter canvas" data-ui="preview.project-canvas-reset"
        onClick={() => setView(INITIAL_VIEW)}><LocateFixed size={14} /></button>
    </div>
  </div>
}
