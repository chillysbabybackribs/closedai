// Prototype-only project file model for the Project shell preview. The file tree is the hive's
// shared state: the orchestrator owns its structure and decisions, workers write notes into it,
// and the user may edit any of it. Files are derived from the direction record, the intake
// transcript, the map nodes, and the journal, with user edits layered on top, so the tree and
// the map are two views of one state rather than two stores.
import { clip, type DirectionRecord } from './project-discovery.js'
import type { Message } from './project-intake.js'
import type { TreeNode } from './project-tree.js'

export type FileOwner = 'user' | 'orchestrator' | 'worker' | 'observer'

export type ProjectFile = {
  path: string
  title: string
  owner: FileOwner
  /** History files keep their original words; everything else is open to continuous editing. */
  editable: boolean
  content: string
  /** Map node this file belongs to; direction aimed at the file lands there. */
  nodeId: string
}

export type ProjectFolder = { name: string; path: string; folders: ProjectFolder[]; files: ProjectFile[] }

export type JournalLine = { id: number; text: string }

export type Location =
  | { kind: 'map' }
  | { kind: 'node'; id: string }
  | { kind: 'file'; path: string }

/** A crumb without a location is a folder segment: it names the place but is not a page. */
export type Crumb = { label: string; location?: Location }

export const slug = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item'

const STATE_WORDS: Record<TreeNode['state'], string> = {
  anchored: 'Anchored', active: 'In progress', queued: 'Queued', complete: 'Complete',
  provisional: 'Working hypothesis', confirmed: 'Confirmed'
}

function recordMarkdown(record: DirectionRecord): string {
  return [
    '# Direction record', '',
    'Current direction. Edit freely; the orchestrator sees every change and the map adapts.', '',
    `## What should exist`, record.idea, '',
    `## Who it is for`, record.user ?? '', '',
    `## First useful session`, record.journey ?? '', '',
    `## Boundaries`, record.boundaries ?? '', '',
    `## Open unknowns`, ...record.unknowns.map((unknown) => `- ${unknown}`)
  ].join('\n')
}

function transcriptMarkdown(messages: Message[]): string {
  return ['# Intake transcript', '', 'The conversation that produced the direction record, as it happened.', '',
    ...messages.map((message) => `**${message.role === 'user' ? 'You' : 'Root coordinator'}**\n${message.text}\n`)
  ].join('\n')
}

function nodePath(node: TreeNode, nodes: TreeNode[]): string | null {
  const parent = node.parent ? nodes.find((entry) => entry.id === node.parent) : null
  switch (node.kind) {
    case 'scope': return `scopes/${node.id}/plan.md`
    case 'task': return `scopes/${parent?.id ?? 'unscoped'}/${node.id}.md`
    case 'research': return `research/${node.id}.md`
    case 'amendment': return `direction/amendments/${node.id}.md`
    default: return null
  }
}

function nodeMarkdown(node: TreeNode): string {
  const lines = [`# ${node.title}`, '', `State: ${STATE_WORDS[node.state]}`, '', node.detail]
  if (node.links?.length) {
    lines.push('', '## Sources', ...node.links.map((link) => `- [${link.label}](${link.url}) — ${link.informs}`))
  }
  if (node.kind === 'task') lines.push('', '## Worker notes', `- Claimed. ${node.summary}.`)
  return lines.join('\n')
}

export function deriveFiles(input: {
  record: DirectionRecord
  messages: Message[]
  nodes: TreeNode[]
  journal: JournalLine[]
  edits: Record<string, string>
}): ProjectFile[] {
  const { record, messages, nodes, journal, edits } = input
  const files: ProjectFile[] = [
    { path: 'request.md', title: 'Original request', owner: 'user', editable: false, nodeId: 'root',
      content: `# Original request\n\nYour words, kept as written. Later steering lands in the record and its amendments.\n\n> ${record.idea}` },
    { path: 'direction/record.md', title: 'Direction record', owner: 'orchestrator', editable: true, nodeId: 'root',
      content: recordMarkdown(record) },
    { path: 'direction/transcript.md', title: 'Intake transcript', owner: 'user', editable: false, nodeId: 'root',
      content: transcriptMarkdown(messages) }
  ]
  if (record.evidence.length) {
    files.push({ path: 'research/discovery-sources.md', title: 'Discovery sources', owner: 'orchestrator', editable: true, nodeId: 'root',
      content: ['# Discovery sources', '', 'Gathered while the direction was being clarified.', '',
        ...record.evidence.map((item) => `- [${item.label}](${item.url}) — ${item.informs}`)].join('\n') })
  }
  for (const node of nodes) {
    const path = nodePath(node, nodes)
    if (!path) continue
    const owner: FileOwner = node.kind === 'task' ? 'worker' : node.kind === 'amendment' ? 'user' : 'orchestrator'
    files.push({ path, title: node.title, owner, editable: true, nodeId: node.id, content: nodeMarkdown(node) })
  }
  const decided = nodes.filter((node) => node.kind === 'research' && node.state === 'confirmed')
  if (decided.length) {
    files.push({ path: 'decisions/log.md', title: 'Decisions', owner: 'orchestrator', editable: true, nodeId: 'root',
      content: ['# Decisions', '', ...decided.map((node) => `- **${node.title}** — ${clip(node.detail, 120)}`)].join('\n') })
  }
  if (journal.length) {
    files.push({ path: 'journal/log.md', title: 'Coordinator journal', owner: 'orchestrator', editable: false, nodeId: 'root',
      content: ['# Coordinator journal', '', ...journal.map((line) => `- ${line.text}`)].join('\n') })
  }
  const quality = nodes.filter((node) => node.parent === 'quality')
  if (quality.length) {
    files.push({ path: 'quality/report.md', title: 'Quality report', owner: 'observer', editable: true, nodeId: 'quality',
      content: ['# Quality report', '', ...quality.map((node) => `- ${node.title}: ${STATE_WORDS[node.state]} — ${node.summary}`)].join('\n') })
  }
  return files.map((file) => file.path in edits ? { ...file, content: edits[file.path]! } : file)
}

export function folderTree(files: ProjectFile[]): ProjectFolder {
  const root: ProjectFolder = { name: 'project', path: '', folders: [], files: [] }
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split('/')
    let folder = root
    for (const part of parts.slice(0, -1)) {
      let next = folder.folders.find((entry) => entry.name === part)
      if (!next) {
        next = { name: part, path: folder.path ? `${folder.path}/${part}` : part, folders: [], files: [] }
        folder.folders.push(next)
      }
      folder = next
    }
    folder.files.push(file)
  }
  return root
}

export function fileAt(files: ProjectFile[], path: string): ProjectFile | null {
  return files.find((file) => file.path === path) ?? null
}

/** Files that belong to a node, in tree order, for the node's detail page. */
export function filesForNode(files: ProjectFile[], nodeId: string): ProjectFile[] {
  return files.filter((file) => file.nodeId === nodeId)
}

export function breadcrumbs(location: Location, nodes: TreeNode[], files: ProjectFile[]): Crumb[] {
  if (location.kind === 'map') return [{ label: 'Map', location }]
  if (location.kind === 'node') {
    const chain: TreeNode[] = []
    let current = nodes.find((node) => node.id === location.id)
    while (current) {
      chain.unshift(current)
      current = current.parent ? nodes.find((node) => node.id === current!.parent) : undefined
    }
    return [{ label: 'Map', location: { kind: 'map' } },
      ...chain.map((node) => ({ label: node.title, location: { kind: 'node' as const, id: node.id } }))]
  }
  const file = fileAt(files, location.path)
  const parts = location.path.split('/')
  const crumbs: Crumb[] = [{ label: 'Files', location: { kind: 'map' } }]
  for (const part of parts.slice(0, -1)) crumbs.push({ label: part })
  crumbs.push({ label: file?.title ?? parts.at(-1) ?? location.path, location })
  return crumbs
}

/** Where composer direction lands for a location: the node itself, or the node a file belongs to. */
export function targetNodeId(location: Location, files: ProjectFile[]): string | null {
  if (location.kind === 'map') return null
  if (location.kind === 'node') return location.id
  return fileAt(files, location.path)?.nodeId ?? 'root'
}

/** The line of intent a node exists to advance; the trace every branch must be able to show. */
export function servesLine(node: TreeNode, nodes: TreeNode[], record: DirectionRecord): string {
  switch (node.kind) {
    case 'root': return record.idea
    case 'amendment': return 'Your steering, recorded so the original words stay intact.'
    case 'research': return record.unknowns.find((unknown) => unknown === node.detail)
      ? `Resolving an open unknown before it can bias the build: ${clip(node.detail, 90)}`
      : 'Evidence behind the direction record.'
    case 'scope':
    case 'task': {
      const scope = node.kind === 'task' ? nodes.find((entry) => entry.id === node.parent) : node
      if (scope?.id === 'journey') return `The first useful session: ${clip(record.journey ?? '', 110)}`
      if (scope?.id === 'quality') return `The boundaries: ${clip(record.boundaries ?? '', 110)}`
      return `What should exist: ${clip(record.idea, 110)}`
    }
  }
}

export const sameLocation = (a: Location, b: Location): boolean =>
  a.kind === b.kind && (a.kind === 'map' || (a.kind === 'node' && b.kind === 'node' && a.id === b.id)
    || (a.kind === 'file' && b.kind === 'file' && a.path === b.path))
