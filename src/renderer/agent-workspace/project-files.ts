// Prototype-only project file model for the Project shell preview. The file tree is the hive's
// shared state: the orchestrator owns its structure and decisions, workers write notes into it,
// and the user may edit any of it. Files are derived from the direction record, the intake
// transcript, the map nodes, and the journal, with user edits layered on top, so the tree and
// the map are two views of one state rather than two stores.
import { handoffMarkdown, proposalMarkdown, reportMarkdown, type AcknowledgedReport, type Progress, type Proposal } from './project-closure.js'
import { clip, type DirectionRecord } from './project-discovery.js'
import type { Message } from './project-intake.js'
import { documentStamp } from './project-time.js'
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
  /** Epoch ms of the last change to this file's content. */
  updatedAt: number
}

export type FileEdit = { content: string; at: number }

export type ProjectFolder = { name: string; path: string; folders: ProjectFolder[]; files: ProjectFile[] }

export type JournalLine = { id: number; at: number; text: string }

export type Location =
  | { kind: 'map' }
  | { kind: 'catchup' }
  | { kind: 'proposal' }
  | { kind: 'node'; id: string }
  | { kind: 'file'; path: string }

/** A crumb without a location is a folder segment: it names the place but is not a page. */
export type Crumb = { label: string; location?: Location }

export const slug = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item'

const STATE_WORDS: Record<TreeNode['state'], string> = {
  anchored: 'Anchored', active: 'In progress', queued: 'Queued', complete: 'Complete',
  provisional: 'Working hypothesis', confirmed: 'Confirmed', blocked: 'Stopped'
}

function recordMarkdown(record: DirectionRecord, confirmedAt: number): string {
  return [
    '# Direction record', '',
    `Confirmed ${documentStamp(confirmedAt)}. Edit freely; the orchestrator sees every change and the map adapts.`, '',
    `## What should exist`, record.idea, '',
    `## Who it is for`, record.user ?? '', '',
    `## First useful session`, record.journey ?? '', '',
    `## Boundaries`, record.boundaries ?? '', '',
    `## Open unknowns`, ...record.unknowns.map((unknown) => `- ${unknown}`)
  ].join('\n')
}

function transcriptMarkdown(messages: Message[]): string {
  return ['# Intake transcript', '', 'The conversation that produced the direction record, as it happened.', '',
    ...messages.map((message) => `**${message.role === 'user' ? 'You' : 'Root coordinator'}** · ${documentStamp(message.at)}\n${message.text}\n`)
  ].join('\n')
}

function nodePath(node: TreeNode, nodes: TreeNode[]): string | null {
  const parent = node.parent ? nodes.find((entry) => entry.id === node.parent) : null
  switch (node.kind) {
    case 'scope': return `scopes/${node.id}/plan.md`
    case 'task': return `scopes/${parent?.id ?? 'unscoped'}/${node.id}.md`
    case 'research': return `research/${node.id}.md`
    case 'amendment': return `direction/amendments/${node.id}.md`
    default: return null // root and proposal have their own generated documents
  }
}

function nodeMarkdown(node: TreeNode): string {
  const lines = [`# ${node.title}`, '', `State: ${STATE_WORDS[node.state]}`, '', node.detail]
  if (node.links?.length) {
    lines.push('', '## Sources', ...node.links.map((link) => `- [${link.label}](${link.url}) — ${link.informs}`))
  }
  if (node.kind === 'task') {
    lines.push('', '## Worker log', `- ${documentStamp(node.createdAt)} — Claimed; read the record and the scope plan.`)
    if (node.updatedAt !== node.createdAt) lines.push(`- ${documentStamp(node.updatedAt)} — ${node.summary}.`)
  }
  lines.push('', '## History', `- ${documentStamp(node.createdAt)} — Opened by the root coordinator.`)
  if (node.updatedAt !== node.createdAt) lines.push(`- ${documentStamp(node.updatedAt)} — ${STATE_WORDS[node.state]}: ${node.summary}.`)
  return lines.join('\n')
}

export function deriveFiles(input: {
  record: DirectionRecord
  messages: Message[]
  nodes: TreeNode[]
  journal: JournalLine[]
  edits: Record<string, FileEdit>
  /** When Start confirmed the record; the birth time of every intake-derived file. */
  confirmedAt: number
  reports: AcknowledgedReport[]
  progress: Progress
  proposal: Proposal | null
  acceptedAt: number | null
}): ProjectFile[] {
  const { record, messages, nodes, journal, edits, confirmedAt, reports, progress, proposal, acceptedAt } = input
  const requestedAt = messages[0]?.at ?? confirmedAt
  const files: ProjectFile[] = [
    { path: 'request.md', title: 'Original request', owner: 'user', editable: false, nodeId: 'root', updatedAt: requestedAt,
      content: `# Original request\n\nWritten ${documentStamp(requestedAt)}. Your words, kept as written; later steering lands in the record and its amendments.\n\n> ${record.idea}` },
    { path: 'direction/record.md', title: 'Direction record', owner: 'orchestrator', editable: true, nodeId: 'root', updatedAt: confirmedAt,
      content: recordMarkdown(record, confirmedAt) },
    { path: 'direction/transcript.md', title: 'Intake transcript', owner: 'user', editable: false, nodeId: 'root',
      updatedAt: messages.at(-1)?.at ?? confirmedAt, content: transcriptMarkdown(messages) }
  ]
  if (record.evidence.length) {
    files.push({ path: 'research/discovery-sources.md', title: 'Discovery sources', owner: 'orchestrator', editable: true, nodeId: 'root',
      updatedAt: confirmedAt, content: ['# Discovery sources', '', `Gathered while the direction was being clarified; direction confirmed ${documentStamp(confirmedAt)}.`, '',
        ...record.evidence.map((item) => `- [${item.label}](${item.url}) — ${item.informs}`)].join('\n') })
  }
  if (acceptedAt) {
    files.push({ path: 'handoff.md', title: 'Handoff', owner: 'orchestrator', editable: true, nodeId: 'root', updatedAt: acceptedAt,
      content: handoffMarkdown({ record, acceptedAt, reports, nodes, progress }) })
  }
  if (proposal) {
    files.push({ path: 'direction/proposal.md', title: 'Completion proposal', owner: 'orchestrator', editable: false, nodeId: 'proposal',
      updatedAt: proposal.at, content: proposalMarkdown(proposal, reports, progress, record) })
  }
  reports.forEach((report, index) => {
    files.push({ path: `reports/${String(index + 1).padStart(2, '0')}-progress.md`, title: `Progress report ${index + 1}`, owner: 'orchestrator',
      editable: false, nodeId: 'root', updatedAt: report.at, content: reportMarkdown(report, index) })
  })
  for (const node of nodes) {
    const path = nodePath(node, nodes)
    if (!path) continue
    const owner: FileOwner = node.kind === 'task' ? 'worker' : node.kind === 'amendment' ? 'user' : 'orchestrator'
    const title = node.kind === 'scope' ? 'Plan' : node.kind === 'amendment' ? clip(node.summary, 48) : node.title
    files.push({ path, title, owner, editable: true, nodeId: node.id, updatedAt: node.updatedAt, content: nodeMarkdown(node) })
  }
  const decided = nodes.filter((node) => node.kind === 'research' && node.state === 'confirmed')
  if (decided.length) {
    files.push({ path: 'decisions/log.md', title: 'Decisions', owner: 'orchestrator', editable: true, nodeId: 'root',
      updatedAt: Math.max(...decided.map((node) => node.updatedAt)),
      content: ['# Decisions', '', ...decided.map((node) => `- ${documentStamp(node.updatedAt)} — **${node.title}** — ${clip(node.detail, 120)}`)].join('\n') })
  }
  if (journal.length) {
    files.push({ path: 'journal/log.md', title: 'Coordinator journal', owner: 'orchestrator', editable: false, nodeId: 'root',
      updatedAt: journal.at(-1)!.at,
      content: ['# Coordinator journal', '', ...journal.map((line) => `- ${documentStamp(line.at)} — ${line.text}`)].join('\n') })
  }
  const quality = nodes.filter((node) => node.parent === 'quality')
  if (quality.length) {
    files.push({ path: 'quality/report.md', title: 'Quality report', owner: 'observer', editable: true, nodeId: 'quality',
      updatedAt: Math.max(...quality.map((node) => node.updatedAt)),
      content: ['# Quality report', '', ...quality.map((node) => `- ${documentStamp(node.updatedAt)} — ${node.title}: ${STATE_WORDS[node.state]} — ${node.summary}`)].join('\n') })
  }
  return files.map((file) => {
    const edit = edits[file.path]
    return edit ? { ...file, content: edit.content, updatedAt: Math.max(file.updatedAt, edit.at) } : file
  })
}

/** Top-level folders in a ladder of importance beneath the original request. */
const FOLDER_ORDER = ['direction', 'reports', 'research', 'decisions', 'scopes', 'quality', 'journal']

export function folderTree(files: ProjectFile[]): ProjectFolder {
  const root: ProjectFolder = { name: 'project', path: '', folders: [], files: [] }
  // The request leads the tree; top-level folders follow FOLDER_ORDER; a scope's plan leads its
  // folder; everything else sorts by path.
  const rank = (path: string) => {
    const [head] = path.split('/')
    const index = FOLDER_ORDER.indexOf(head!)
    if (!path.includes('/')) return path === 'request.md' ? 0 : 1 // request first, then handoff
    return (index === -1 ? FOLDER_ORDER.length : index) + 2
  }
  const key = (file: ProjectFile) => `${rank(file.path)}:${file.path.replace(/plan\.md$/, ' plan.md')}`
  for (const file of [...files].sort((a, b) => key(a).localeCompare(key(b)))) {
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
  if (location.kind === 'catchup') return [{ label: 'Map', location: { kind: 'map' } }, { label: 'Catch-up', location }]
  if (location.kind === 'proposal') return [{ label: 'Map', location: { kind: 'map' } }, { label: 'Completion proposal', location }]
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
  if (location.kind === 'map' || location.kind === 'catchup') return null
  if (location.kind === 'proposal') return 'proposal'
  if (location.kind === 'node') return location.id
  return fileAt(files, location.path)?.nodeId ?? 'root'
}

/** The line of intent a node exists to advance; the trace every branch must be able to show. */
export function servesLine(node: TreeNode, nodes: TreeNode[], record: DirectionRecord): string {
  switch (node.kind) {
    case 'root': return record.idea
    case 'amendment': return 'Your steering, recorded so the original words stay intact.'
    case 'proposal': return 'Closing the record: every gate met and already shown to you in an acknowledged report.'
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
  a.kind === b.kind && (a.kind === 'map' || a.kind === 'catchup' || a.kind === 'proposal' || (a.kind === 'node' && b.kind === 'node' && a.id === b.id)
    || (a.kind === 'file' && b.kind === 'file' && a.path === b.path))
