// Prototype-only tree model for the Project shell preview: a vertical tree that grows from the
// root coordinator as it dispatches work, a tidy layout for it, and a simulated dispatch plan
// derived from the confirmed direction record.
import { clip, describeRecord, type DirectionRecord, type EvidenceItem } from './project-discovery.js'

export type TreeKind = 'root' | 'scope' | 'task' | 'research' | 'amendment' | 'proposal'
export type TreeState = 'anchored' | 'active' | 'queued' | 'complete' | 'provisional' | 'confirmed'

export type TreeNode = {
  id: string
  parent?: string
  kind: TreeKind
  state: TreeState
  title: string
  summary: string
  detail: string
  links?: EvidenceItem[]
  /** Epoch ms. Every node records when it appeared and when it last changed. */
  createdAt: number
  updatedAt: number
}

export type PlacedNode = TreeNode & { x: number; y: number; depth: number }
export type TreeLayout = { nodes: PlacedNode[]; width: number; height: number }

export const NODE_WIDTH = 176
export const NODE_HEIGHT = 54
const GAP_X = 20
const GAP_Y = 74

/** Tidy vertical layout: parents centred over their children, siblings never overlapping. */
export function layoutTree(nodes: TreeNode[]): TreeLayout {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<string, TreeNode[]>()
  const roots: TreeNode[] = []
  for (const node of nodes) {
    if (node.parent && byId.has(node.parent)) {
      const list = children.get(node.parent) ?? []
      list.push(node)
      children.set(node.parent, list)
    } else roots.push(node)
  }

  const widths = new Map<string, number>()
  const measure = (node: TreeNode): number => {
    const kids = children.get(node.id) ?? []
    const width = kids.length
      ? kids.reduce((sum, kid) => sum + measure(kid), 0) + GAP_X * (kids.length - 1)
      : NODE_WIDTH
    widths.set(node.id, Math.max(width, NODE_WIDTH))
    return widths.get(node.id)!
  }

  const placed: PlacedNode[] = []
  let maxDepth = 0
  const place = (node: TreeNode, left: number, depth: number): void => {
    maxDepth = Math.max(maxDepth, depth)
    const kids = children.get(node.id) ?? []
    let x = left
    if (kids.length) {
      let cursor = left
      for (const kid of kids) {
        place(kid, cursor, depth + 1)
        cursor += widths.get(kid.id)! + GAP_X
      }
      // Children are pushed post-order, so read their x back from the placed list.
      const xs = kids.map((kid) => placed.find((entry) => entry.id === kid.id)!.x)
      x = (xs[0]! + xs[xs.length - 1]!) / 2
    }
    placed.push({ ...node, x, y: depth * (NODE_HEIGHT + GAP_Y), depth })
  }

  let cursor = 0
  for (const root of roots) {
    measure(root)
    place(root, cursor, 0)
    cursor += widths.get(root.id)! + GAP_X
  }
  return {
    nodes: placed,
    width: Math.max(cursor - GAP_X, NODE_WIDTH),
    height: (maxDepth + 1) * NODE_HEIGHT + maxDepth * GAP_Y
  }
}

/** A node as the dispatch plan describes it; timestamps are stamped when the event lands. */
export type PlannedNode = Omit<TreeNode, 'createdAt' | 'updatedAt'>

export type DispatchEvent = { delay: number; note: string } & (
  | { add: PlannedNode }
  | { update: { id: string; state: TreeState; summary?: string } }
)

export function rootNode(record: DirectionRecord, at: number): TreeNode {
  return {
    id: 'root', kind: 'root', state: 'anchored', title: 'Root coordinator',
    summary: clip(record.idea, 46), detail: describeRecord(record), links: record.evidence,
    createdAt: at, updatedAt: at
  }
}

const scope = (id: string, title: string, summary: string, detail: string): PlannedNode =>
  ({ id, parent: 'root', kind: 'scope', state: 'active', title, summary, detail })
const task = (id: string, parent: string, title: string, summary: string, state: TreeState, detail: string): PlannedNode =>
  ({ id, parent, kind: 'task', state, title, summary, detail })

/** The simulated root coordinator's first minutes: scopes open, work is dispatched, results land. */
export function buildDispatchPlan(record: DirectionRecord): DispatchEvent[] {
  const journey = record.journey ?? 'the central journey'
  const [unknownA = 'Open question', unknownB = 'Open question'] = record.unknowns
  return [
    { delay: 800, note: 'Opened scope: Foundation. A runnable shell comes before anything else.',
      add: scope('foundation', 'Foundation', 'A runnable shell first', 'Nothing in the journey can be judged until the application runs. This scope owns the shell and the smallest data model beneath it.') },
    { delay: 900, note: 'Dispatched: runnable shell → worker',
      add: task('shell', 'foundation', 'Runnable shell', 'Building', 'active', 'Worker is producing the minimal runnable application. Success is a launchable shell with the primary surface visible.') },
    { delay: 1000, note: 'Opened scope: Primary journey, from the confirmed first session.',
      add: scope('journey', 'Primary journey', clip(journey, 44), `Owns the confirmed first session: “${journey}”. Every task here must explain how it advances that session.`) },
    { delay: 800, note: 'Discovery continues beside the build; each unknown gets its own research thread.',
      add: scope('discovery', 'Discovery', 'Unknowns resolved with evidence', 'Research is organized around the record’s open unknowns. Findings attach here as evidence and promote to decisions.') },
    { delay: 500, note: `Attached ${record.evidence.length} sources gathered during discovery.`,
      add: { id: 'evidence', parent: 'discovery', kind: 'research', state: 'confirmed', title: 'Discovery evidence',
        summary: `${record.evidence.length} sources · from intake`, detail: 'Sources the coordinator gathered while the direction was being clarified. They inform the record rather than sitting in a separate reading list.', links: record.evidence } },
    { delay: 700, note: `Research thread: ${clip(unknownA, 60)}`,
      add: { id: 'unknown-0', parent: 'discovery', kind: 'research', state: 'active', title: clip(unknownA, 30), summary: 'Researching', detail: unknownA } },
    { delay: 600, note: `Research thread: ${clip(unknownB, 60)}`,
      add: { id: 'unknown-1', parent: 'discovery', kind: 'research', state: 'provisional', title: clip(unknownB, 30), summary: 'Working hypothesis', detail: unknownB } },
    { delay: 900, note: 'Queued: journey prototype, waiting on the shell.',
      add: task('journey-proto', 'journey', 'Journey prototype', 'Queued until the shell runs', 'queued', 'First end-to-end pass at the confirmed session. Blocked on the runnable shell; the worker is reading the record meanwhile.') },
    { delay: 900, note: 'Quality observers attached: tests, hygiene, tool health.',
      add: scope('quality', 'Quality', 'Observers beside the build', 'Tests, hygiene caps, duplicate code, and tool failures are watched continuously rather than at the end.') },
    { delay: 700, note: 'Dispatched: baseline checks → observer',
      add: task('baseline', 'quality', 'Baseline checks', 'Tests · hygiene · tool health', 'active', 'Establishes the checks every later task must keep green.') },
    { delay: 1500, note: 'Foundation: runnable shell verified.',
      update: { id: 'shell', state: 'complete', summary: 'Verified · shell runs' } },
    { delay: 500, note: 'Journey prototype unblocked and dispatched.',
      update: { id: 'journey-proto', state: 'active', summary: 'Building against the shell' } },
    { delay: 900, note: 'Dispatched: data model sketch → worker',
      add: task('data-model', 'foundation', 'Data model sketch', 'Smallest model for the first session', 'active', 'Derives the minimum persistent shape from the journey prototype rather than designing the full model up front.') },
    { delay: 1600, note: `Research resolved: ${clip(unknownA, 60)}`,
      update: { id: 'unknown-0', state: 'confirmed', summary: 'Conclusion recorded' } },
    // The build then runs to a state where every closure gate can be met, so the prototype can
    // show the report → acknowledgement → proposal → acceptance path end to end.
    { delay: 2600, note: 'Foundation: data model settled against the prototype.',
      update: { id: 'data-model', state: 'complete', summary: 'Settled · three entities' } },
    { delay: 2200, note: `Research resolved: ${clip(unknownB, 60)}`,
      update: { id: 'unknown-1', state: 'confirmed', summary: 'Hypothesis confirmed' } },
    { delay: 2800, note: 'Primary journey: first useful session demonstrated end to end.',
      update: { id: 'journey-proto', state: 'complete', summary: 'Demonstrated end to end' } },
    { delay: 1800, note: 'Quality: baseline checks green across the build.',
      update: { id: 'baseline', state: 'complete', summary: 'All green' } }
  ]
}

export function applyEvent(nodes: TreeNode[], event: DispatchEvent, at: number): TreeNode[] {
  if ('add' in event) {
    return nodes.some((node) => node.id === event.add.id) ? nodes : [...nodes, { ...event.add, createdAt: at, updatedAt: at }]
  }
  return nodes.map((node) => node.id === event.update.id
    ? { ...node, state: event.update.state, summary: event.update.summary ?? node.summary, updatedAt: at }
    : node)
}

function subtreeIds(nodes: TreeNode[], rootId: string): Set<string> {
  const ids = new Set([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const node of nodes) {
      if (node.parent && ids.has(node.parent) && !ids.has(node.id)) { ids.add(node.id); grew = true }
    }
  }
  return ids
}

/** Attach user direction under the selected node (or the root) and describe the ripple. */
export function amendTree(nodes: TreeNode[], text: string, targetId: string | null, at: number): { nodes: TreeNode[]; note: string } {
  const target = nodes.find((node) => node.id === targetId) ?? nodes.find((node) => node.id === 'root')
  if (!target) return { nodes, note: 'No root to attach direction to.' }
  const affected = subtreeIds(nodes, target.id)
  const activeTasks = nodes.filter((node) => node.kind === 'task' && node.state === 'active')
  const adapting = activeTasks.filter((node) => affected.has(node.id)).length
  const continuing = activeTasks.length - adapting
  const count = nodes.filter((node) => node.kind === 'amendment').length + 1
  const amendment: TreeNode = {
    id: `amendment-${count}`, parent: target.id, kind: 'amendment', state: 'confirmed',
    title: 'Amendment', summary: clip(text, 44),
    detail: `User direction, recorded as an amendment under “${target.title}” so the original words stay intact:\n\n${text}`,
    createdAt: at, updatedAt: at
  }
  const where = target.id === 'root' ? 'the whole project' : `“${target.title}”`
  // The target now carries direction it must re-read, so it counts as changed too.
  return {
    nodes: [...nodes.map((node) => node.id === target.id ? { ...node, updatedAt: at } : node), amendment],
    note: `Direction absorbed for ${where}: ${continuing} continuing · ${adapting} adapting next.`
  }
}
