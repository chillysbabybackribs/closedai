// Prototype-only catch-up report for the Project shell preview. The user lands back after an
// absence and gets what changed since they last caught up, ordered by how much it needs them:
// decisions waiting first, direction changes, then finished, started, and opened work. Each
// section is capped so the report reads in a minute; every line links to where it happened.
import type { Progress } from './project-closure.js'
import type { Location, ProjectFile } from './project-files.js'
import type { TreeNode } from './project-tree.js'

export type CatchUpTone = 'attention' | 'direction' | 'done' | 'active' | 'opened'

export type CatchUpItem = { at: number; text: string; location: Location }

export type CatchUpSection = { tone: CatchUpTone; title: string; items: CatchUpItem[]; more: number }

export type CatchUpReport = { since: number; now: number; total: number; sections: CatchUpSection[]; progress: Progress }

export const SECTION_CAP = 5

const byRecent = (a: CatchUpItem, b: CatchUpItem) => b.at - a.at

function section(tone: CatchUpTone, title: string, items: CatchUpItem[]): CatchUpSection | null {
  if (!items.length) return null
  const sorted = [...items].sort(byRecent)
  return { tone, title, items: sorted.slice(0, SECTION_CAP), more: Math.max(0, sorted.length - SECTION_CAP) }
}

const node = (entry: TreeNode): Location => ({ kind: 'node', id: entry.id })

export function buildCatchUp(input: { nodes: TreeNode[]; files: ProjectFile[]; since: number; now: number; progress: Progress }): CatchUpReport {
  const { nodes, files, since, now, progress } = input
  const fresh = (at: number) => at > since
  const title = (id: string | undefined) => nodes.find((entry) => entry.id === id)?.title ?? 'the project'

  // Standing needs are not time-filtered: something waiting on you is the headline however old.
  const attention: CatchUpItem[] = [
    ...nodes.filter((entry) => entry.kind === 'proposal' && entry.state === 'provisional')
      .map((entry) => ({ at: entry.createdAt, location: { kind: 'proposal' as const }, text: 'Completion proposed — walk the acceptance, then accept or name the gap' })),
    ...nodes.filter((entry) => entry.kind === 'research' && entry.state === 'provisional')
      .map((entry) => ({ at: entry.updatedAt, location: node(entry), text: `Working hypothesis awaits your confirmation: ${entry.title}` })),
    ...nodes.filter((entry) => entry.kind === 'task' && entry.state === 'queued')
      .map((entry) => ({ at: entry.updatedAt, location: node(entry), text: `Blocked: ${entry.title} — ${entry.summary}` }))
  ]

  const direction: CatchUpItem[] = [
    ...nodes.filter((entry) => entry.kind === 'amendment' && fresh(entry.createdAt))
      .map((entry) => ({ at: entry.createdAt, location: node(entry), text: `Amended “${title(entry.parent)}”: ${entry.summary}` })),
    // Direct edits to direction files that did not arrive as an amendment (amendment files
    // share their node's timestamp, so they are already listed above).
    ...files.filter((file) => file.path.startsWith('direction/') && file.editable && fresh(file.updatedAt))
      .filter((file) => !nodes.some((entry) => entry.kind === 'amendment' && entry.createdAt === file.updatedAt))
      .map((file) => ({ at: file.updatedAt, location: { kind: 'file' as const, path: file.path }, text: `${file.title} edited directly` }))
  ]

  const done: CatchUpItem[] = nodes
    .filter((entry) => (entry.kind === 'task' || entry.kind === 'research') && fresh(entry.updatedAt)
      && (entry.state === 'complete' || entry.state === 'confirmed') && entry.updatedAt !== entry.createdAt)
    .map((entry) => ({ at: entry.updatedAt, location: node(entry),
      text: `${entry.kind === 'research' ? 'Resolved' : 'Finished'}: ${entry.title} — ${entry.summary}` }))

  const active: CatchUpItem[] = nodes
    .filter((entry) => (entry.kind === 'task' || entry.kind === 'research') && entry.state === 'active' && fresh(entry.updatedAt))
    .map((entry) => ({ at: entry.updatedAt, location: node(entry),
      text: `${fresh(entry.createdAt) ? 'Started' : 'Progressing'}: ${entry.title} under ${title(entry.parent)}` }))

  const opened: CatchUpItem[] = [
    ...nodes.filter((entry) => entry.kind === 'scope' && fresh(entry.createdAt))
      .map((entry) => ({ at: entry.createdAt, location: node(entry), text: `Scope opened: ${entry.title} — ${entry.summary}` })),
    ...nodes.filter((entry) => entry.kind === 'research' && entry.state === 'confirmed' && fresh(entry.createdAt) && entry.createdAt === entry.updatedAt)
      .map((entry) => ({ at: entry.createdAt, location: node(entry), text: `Evidence attached: ${entry.title} — ${entry.summary}` }))
  ]

  const sections = [
    section('attention', 'Needs you', attention),
    section('direction', 'Direction changed', direction),
    section('done', 'Finished', done),
    section('active', 'In progress', active),
    section('opened', 'Opened', opened)
  ].filter((entry): entry is CatchUpSection => entry !== null)

  return { since, now, sections, progress, total: sections.reduce((sum, entry) => sum + entry.items.length + entry.more, 0) }
}

/** How many things changed since the user last caught up; drives the badge on the button. */
export function countSince(nodes: TreeNode[], since: number): number {
  return nodes.filter((entry) => entry.updatedAt > since).length
}

/** One line per item, for the acknowledged report document. */
export function reportLines(report: CatchUpReport): string[] {
  return report.sections.flatMap((section) => [
    ...section.items.map((item) => `${section.title}: ${item.text}`),
    ...(section.more ? [`${section.title}: and ${section.more} more`] : [])
  ])
}
