import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canPropose, closureProgress, handoffMarkdown, proposalMarkdown, reportMarkdown, type AcknowledgedReport } from './project-closure.ts'
import { advanceDiscovery, createDiscovery } from './project-discovery.ts'
import { deriveFiles } from './project-files.ts'
import { amendTree, applyEvent, buildDispatchPlan, rootNode, type TreeNode } from './project-tree.ts'

const T0 = Date.UTC(2026, 8, 22, 4, 0, 0)

function record() {
  let state = createDiscovery()
  for (const answer of [
    'A desktop research tool for journalists that links captured source pages to claims.',
    'Investigative journalists at small newsrooms.',
    'Capture a source page and link it to one claim in a draft.',
    'Not a general note app; offline-first and citations are non-negotiable.'
  ]) state = advanceDiscovery(state, answer).state
  return state.record
}

function run(events = Number.POSITIVE_INFINITY) {
  const rec = record()
  let nodes = [rootNode(rec, T0)]
  let clock = T0
  for (const event of buildDispatchPlan(rec).slice(0, events)) nodes = applyEvent(nodes, event, clock += event.delay)
  return { rec, nodes, clock }
}

const ack = (id: number, at: number, nodes: TreeNode[], rec: ReturnType<typeof record>): AcknowledgedReport =>
  ({ id, since: at - 60_000, at, changes: 4, progress: closureProgress(nodes, rec), lines: ['Finished: something'] })

test('gates are proven against the record and only all met at the end of the build', () => {
  const early = run(13)
  const progress = closureProgress(early.nodes, early.rec)
  assert.equal(progress.total, 5)
  assert.equal(progress.met, 1, 'boundaries hold; nothing else is proven yet')
  assert.match(progress.gates.find((gate) => gate.id === 'unknowns')!.evidence, /1 of 3 research threads still open/)

  const full = run()
  const finished = closureProgress(full.nodes, full.rec)
  assert.equal(finished.met, 5)
  assert.match(finished.gates.find((gate) => gate.id === 'journey')!.evidence, /link it to one claim.*end to end/)
})

test('a proposal is licensed only by an acknowledged report showing this exact state with nothing since', () => {
  const { rec, nodes, clock } = run()
  const progress = closureProgress(nodes, rec)
  assert.equal(canPropose({ progress, reports: [], nodes }), null, 'no report, no proposal')

  const earlyReport = ack(1, clock - 30_000, run(13).nodes, rec)
  assert.equal(canPropose({ progress, reports: [earlyReport], nodes }), null, 'a report from before the gates were met does not count')

  const stale = ack(2, clock - 1, nodes, rec)
  assert.equal(canPropose({ progress, reports: [stale], nodes }), null, 'nodes changed after the acknowledgement')

  const current = ack(3, clock + 1_000, nodes, rec)
  assert.equal(canPropose({ progress, reports: [earlyReport, current], nodes })?.id, 3, 'the latest acknowledged report licenses it')

  const amended = amendTree(nodes, 'Needs CMS export.', 'root', clock + 2_000).nodes
  assert.equal(canPropose({ progress: closureProgress(amended, rec), reports: [earlyReport, current], nodes: amended }), null, 'new direction withdraws the licence')

  const partial = run(13)
  assert.equal(canPropose({ progress: closureProgress(partial.nodes, rec), reports: [ack(4, partial.clock + 1, partial.nodes, rec)], nodes: partial.nodes }), null, 'unmet gates never propose')
})

test('reports, the proposal, and the handoff are dated documents in the tree', () => {
  const { rec, nodes, clock } = run()
  const progress = closureProgress(nodes, rec)
  const reports = [ack(1, clock + 1_000, nodes, rec)]
  const proposal = { at: clock + 2_000, reportId: 1 }
  assert.match(reportMarkdown(reports[0]!, 0), /# Progress report 1\n\nCovered .* → .*Acknowledged by the user .*\n\n## Completion progress · 5 of 5 gates\n- \[x\] Runs/)
  assert.match(proposalMarkdown(proposal, reports, progress, rec), /resting on progress report 1 \(acknowledged .*\)/)
  assert.match(proposalMarkdown(proposal, reports, progress, rec), /## Acceptance walk\n1\. Open the application as Investigative journalists/)
  assert.match(handoffMarkdown({ record: rec, acceptedAt: clock + 3_000, reports, nodes, progress }), /after 1 acknowledged progress report\./)

  const files = deriveFiles({ record: rec, messages: [], nodes, journal: [], edits: {}, confirmedAt: T0, reports, progress, proposal, acceptedAt: clock + 3_000 })
  const paths = files.map((file) => file.path)
  assert.ok(paths.includes('reports/01-progress.md') && paths.includes('direction/proposal.md') && paths.includes('handoff.md'))
  assert.equal(files.find((file) => file.path === 'reports/01-progress.md')!.editable, false, 'acknowledged reports are history')
  assert.equal(files.find((file) => file.path === 'handoff.md')!.updatedAt, clock + 3_000)
})
