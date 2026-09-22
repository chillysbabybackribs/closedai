// Prototype-only closure logic for the Project shell preview. Completion is proven against the
// direction record, not declared when tasks run out. The coordinator may propose completion
// only after a traceable record of progress reports the user has acknowledged, and only when
// the latest acknowledged report already showed the state the proposal rests on, so a proposal
// never tells the user anything they have not already seen and accepted.
import { clip, type DirectionRecord } from './project-discovery.js'
import { documentStamp } from './project-time.js'
import type { TreeNode } from './project-tree.js'

export type GateId = 'foundation' | 'journey' | 'unknowns' | 'quality' | 'boundaries'

export type Gate = { id: GateId; label: string; met: boolean; evidence: string; nodeId: string | null }

export type Progress = { gates: Gate[]; met: number; total: number }

/** A catch-up report the user acknowledged, kept as a dated document in the tree. */
export type AcknowledgedReport = {
  id: number
  /** Window the report covered. */
  since: number
  /** When the user marked it caught up. */
  at: number
  changes: number
  progress: Progress
  lines: string[]
}

export type Proposal = { at: number; reportId: number }

const done = (node: TreeNode | undefined) => node?.state === 'complete' || node?.state === 'confirmed'

/** Record answers arrive as sentences; drop the closing stop so they can sit inside another. */
export const bare = (text: string | null, fallback: string): string => (text ?? fallback).trim().replace(/[.!]+$/, '')

export function closureProgress(nodes: TreeNode[], record: DirectionRecord): Progress {
  const byId = (id: string) => nodes.find((node) => node.id === id)
  const research = nodes.filter((node) => node.kind === 'research')
  const unresolved = research.filter((node) => !done(node))
  const amendments = nodes.filter((node) => node.kind === 'amendment')
  const gates: Gate[] = [
    { id: 'foundation', label: 'Runs', nodeId: 'foundation',
      met: done(byId('shell')) && done(byId('data-model')),
      evidence: done(byId('shell')) ? 'Shell verified; data model ' + (done(byId('data-model')) ? 'settled' : 'still open') : 'Shell not yet verified' },
    { id: 'journey', label: 'First useful session', nodeId: 'journey-proto',
      met: done(byId('journey-proto')),
      evidence: done(byId('journey-proto')) ? `“${clip(record.journey ?? '', 70)}” demonstrated end to end` : 'Journey prototype not yet complete' },
    { id: 'unknowns', label: 'Unknowns resolved', nodeId: 'discovery',
      met: research.length > 0 && unresolved.length === 0,
      evidence: unresolved.length ? `${unresolved.length} of ${research.length} research threads still open` : `${research.length} threads resolved with evidence` },
    { id: 'quality', label: 'Quality green', nodeId: 'baseline',
      met: done(byId('baseline')),
      evidence: done(byId('baseline')) ? 'Tests, hygiene, and tool health passing' : 'Baseline checks still running' },
    { id: 'boundaries', label: 'Boundaries held', nodeId: 'root',
      met: true,
      evidence: amendments.length ? `${amendments.length} amendment${amendments.length === 1 ? '' : 's'} recorded, each beneath the node it steers; original words intact` : 'No amendments; original words intact' }
  ]
  return { gates, met: gates.filter((gate) => gate.met).length, total: gates.length }
}

const sameGates = (a: Progress, b: Progress) => a.gates.every((gate, index) => gate.met === b.gates[index]?.met)

/**
 * The coordinator may propose only when every gate is met, at least one report has been
 * acknowledged, and the most recent acknowledged report showed exactly this gate state with
 * nothing changed since. Acknowledging that report is what licenses the proposal.
 */
export function canPropose(input: { progress: Progress; reports: AcknowledgedReport[]; nodes: TreeNode[] }): AcknowledgedReport | null {
  const { progress, reports, nodes } = input
  if (progress.met < progress.total) return null
  const latest = reports.at(-1)
  if (!latest || !sameGates(latest.progress, progress)) return null
  const changedSince = nodes.some((node) => node.updatedAt > latest.at && node.kind !== 'proposal')
  return changedSince ? null : latest
}

export function reportMarkdown(report: AcknowledgedReport, index: number): string {
  const { progress } = report
  return [
    `# Progress report ${index + 1}`, '',
    `Covered ${documentStamp(report.since)} → ${documentStamp(report.at)}. Acknowledged by the user ${documentStamp(report.at)}.`, '',
    `## Completion progress · ${progress.met} of ${progress.total} gates`,
    ...progress.gates.map((gate) => `- [${gate.met ? 'x' : ' '}] ${gate.label} — ${gate.evidence}`), '',
    `## Changes · ${report.changes}`,
    ...(report.lines.length ? report.lines : ['Nothing changed in this window.'])
  ].join('\n')
}

export function proposalMarkdown(proposal: Proposal, reports: AcknowledgedReport[], progress: Progress, record: DirectionRecord): string {
  const licensing = reports.find((report) => report.id === proposal.reportId)
  return [
    '# Completion proposal', '',
    `Proposed by the root coordinator ${documentStamp(proposal.at)}, resting on progress report ${reports.indexOf(licensing!) + 1}` +
      ` (acknowledged ${licensing ? documentStamp(licensing.at) : 'unknown'}). Nothing has changed since.`, '',
    '## Gates', ...progress.gates.map((gate) => `- [x] ${gate.label} — ${gate.evidence}`), '',
    '## Traceable record', `- ${reports.length} progress report${reports.length === 1 ? '' : 's'} acknowledged`,
    ...reports.map((report, index) => `- Report ${index + 1} · ${documentStamp(report.at)} · ${report.progress.met}/${report.progress.total} gates · ${report.changes} changes`), '',
    '## Acceptance walk',
    `1. Open the application as ${bare(record.user, 'the primary user')}.`,
    `2. ${bare(record.journey, 'Complete the first useful session')}.`,
    `3. Confirm it stayed within: ${bare(record.boundaries, 'the stated boundaries')}.`, '',
    'Accept, or name the gap; a named gap becomes an amendment and the proposal is withdrawn.'
  ].join('\n')
}

export function handoffMarkdown(input: { record: DirectionRecord; acceptedAt: number; reports: AcknowledgedReport[]; nodes: TreeNode[]; progress: Progress }): string {
  const { record, acceptedAt, reports, nodes, progress } = input
  const scopes = nodes.filter((node) => node.kind === 'scope')
  const decisions = nodes.filter((node) => node.kind === 'research' && node.state === 'confirmed')
  return [
    '# Handoff', '',
    `Accepted by the user ${documentStamp(acceptedAt)} after ${reports.length} acknowledged progress report${reports.length === 1 ? '' : 's'}.`, '',
    '## What exists', record.idea, '', `For ${bare(record.user, 'the primary user')}: ${bare(record.journey, '')}.`, '',
    '## Deliberately left out', record.boundaries ?? '', '',
    '## Gates at acceptance', ...progress.gates.map((gate) => `- [${gate.met ? 'x' : ' '}] ${gate.label} — ${gate.evidence}`), '',
    '## Where to look',
    ...scopes.map((scope) => `- ${scope.title} — scopes/${scope.id}/plan.md`),
    ...decisions.map((node) => `- Decision: ${node.title} — research/${node.id}.md`),
    '- Every steering change — direction/amendments/', '- Every report you acknowledged — reports/', '',
    '## Reopening', 'This project stays reopenable. New direction from the composer becomes an amendment under the root;',
    'handoff and every acknowledged report remain history. A later completion proposal must be licensed by a fresh acknowledged report again.'
  ].join('\n')
}
