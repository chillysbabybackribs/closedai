import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCatchUp, countSince, SECTION_CAP } from './project-catchup.ts'
import { closureProgress } from './project-closure.ts'
import { advanceDiscovery, createDiscovery } from './project-discovery.ts'
import { breadcrumbs, deriveFiles, folderTree, servesLine, targetNodeId } from './project-files.ts'
import type { Message } from './project-intake.ts'
import { duration, relative } from './project-time.ts'
import { amendTree, applyEvent, buildDispatchPlan, rootNode } from './project-tree.ts'

const T0 = Date.UTC(2026, 8, 22, 4, 0, 0)
const MINUTE = 60_000

function build(events = Number.POSITIVE_INFINITY) {
  let state = createDiscovery()
  const messages: Message[] = []
  let at = T0
  for (const answer of [
    'A desktop research tool for journalists that links captured source pages to claims.',
    'Investigative journalists at small newsrooms.',
    'Capture a source page and link it to one claim in a draft.',
    'Not a general note app; offline-first and citations are non-negotiable.'
  ]) {
    messages.push({ id: messages.length, at: at += MINUTE, role: 'user', text: answer })
    const next = advanceDiscovery(state, answer)
    state = next.state
    messages.push({ id: messages.length, at: at += MINUTE, role: 'coordinator', text: next.reply })
  }
  const record = state.record
  const confirmedAt = at + MINUTE
  let nodes = [rootNode(record, confirmedAt)]
  let clock = confirmedAt
  for (const event of buildDispatchPlan(record).slice(0, events)) nodes = applyEvent(nodes, event, clock += event.delay)
  return { record, messages, nodes, confirmedAt, now: clock + MINUTE, progress: closureProgress(nodes, record) }
}

const base = (input: ReturnType<typeof build>) =>
  ({ record: input.record, messages: input.messages, nodes: input.nodes, journal: [], edits: {}, confirmedAt: input.confirmedAt,
    reports: [], progress: input.progress, proposal: null, acceptedAt: null })

test('files are derived from the record, transcript, map, and journal, with edits layered on top', () => {
  const built = build()
  const files = deriveFiles({ ...base(built), journal: [{ id: 1, at: built.confirmedAt, text: 'Direction confirmed.' }] })
  const paths = files.map((file) => file.path)
  assert.ok(paths.includes('request.md') && paths.includes('direction/record.md') && paths.includes('direction/transcript.md'))
  assert.ok(paths.includes('journal/log.md') && paths.includes('research/discovery-sources.md'))
  assert.ok(paths.some((path) => /^scopes\/[^/]+\/plan\.md$/.test(path)), 'each scope gets a plan')
  assert.ok(paths.some((path) => /^scopes\/[^/]+\/(?!plan\.md)[^/]+\.md$/.test(path)), 'each task gets worker notes beside the plan')
  assert.equal(new Set(paths).size, paths.length, 'paths are unique')

  const request = files.find((file) => file.path === 'request.md')!
  assert.equal(request.editable, false, 'original words are history')
  assert.equal(request.updatedAt, built.messages[0]!.at, 'the request is stamped when it was written')
  assert.match(request.content, /links captured source pages to claims/)
  assert.equal(files.find((file) => file.path === 'direction/record.md')!.editable, true)
  assert.equal(files.find((file) => file.path === 'direction/transcript.md')!.content.match(/\*\*You\*\*/g)?.length, 4)
  for (const file of files) assert.ok(file.updatedAt > 0, `${file.path} carries a timestamp`)
  const shell = built.nodes.find((node) => node.id === 'shell')!
  const shellFile = files.find((file) => file.path === 'scopes/foundation/shell.md')!
  assert.equal(shellFile.updatedAt, shell.updatedAt)
  assert.match(shellFile.content, /## Worker log\n- \w+ \d+, \d{4}, .* — Claimed/, 'worker notes are a dated running log')
  assert.match(shellFile.content, /## History\n- .*Opened by the root coordinator\.\n- .*Complete: Verified/, 'every node file closes with a dated history')
  assert.match(files.find((file) => file.path === 'direction/transcript.md')!.content, /\*\*You\*\* · \w+ \d+, \d{4}/)

  const editAt = built.now + MINUTE
  const edited = deriveFiles({ ...base(built), edits: { 'direction/record.md': { content: '# Direction record\n\nrewritten', at: editAt } } })
  const recordFile = edited.find((file) => file.path === 'direction/record.md')!
  assert.equal(recordFile.content, '# Direction record\n\nrewritten')
  assert.equal(recordFile.updatedAt, editAt, 'an edit moves the file stamp')
  assert.equal(edited.find((file) => file.path === 'request.md')!.content, request.content, 'edits touch only their file')
})

test('the tree leads with the request and ladders folders by importance', () => {
  const built = build()
  const files = deriveFiles({ ...base(built), journal: [{ id: 1, at: built.confirmedAt, text: 'Direction confirmed.' }] })
  const root = folderTree(files)
  assert.deepEqual(root.files.map((file) => file.path), ['request.md'])
  assert.deepEqual(root.folders.map((folder) => folder.name), ['direction', 'research', 'decisions', 'scopes', 'quality', 'journal'], 'reports/ appears once one is acknowledged')
  const scopes = root.folders.find((folder) => folder.name === 'scopes')!
  const foundation = scopes.folders.find((folder) => folder.name === 'foundation')!
  assert.equal(foundation.files[0]!.title, 'Plan', 'a scope plan leads its folder')
  assert.equal(foundation.folders.length, 0, 'task notes sit flat beside the scope plan')
  const ids = new Set(built.nodes.map((node) => node.id))
  for (const file of files) assert.ok(ids.has(file.nodeId), `${file.path} points at a real node`)
})

test('breadcrumbs trace nodes to the root and files to their folders; direction lands on the owning node', () => {
  const built = build()
  const { nodes, record } = built
  const files = deriveFiles(base(built))
  const task = nodes.find((node) => node.id === 'journey-proto')!
  const nodeCrumbs = breadcrumbs({ kind: 'node', id: task.id }, nodes, files)
  assert.equal(nodeCrumbs[0]!.label, 'Map')
  assert.equal(nodeCrumbs.at(-1)!.label, task.title)
  assert.equal(nodeCrumbs.length, 4, 'Map › root › scope › task')

  const notes = `scopes/journey/${task.id}.md`
  const fileCrumbs = breadcrumbs({ kind: 'file', path: notes }, nodes, files)
  assert.deepEqual(fileCrumbs.map((crumb) => crumb.label), ['Files', 'scopes', 'journey', task.title])
  assert.equal(fileCrumbs[1]!.location, undefined, 'folder segments are labels, not pages')
  assert.equal(targetNodeId({ kind: 'file', path: notes }, files), task.id)
  assert.equal(targetNodeId({ kind: 'file', path: 'direction/record.md' }, files), 'root')
  assert.equal(targetNodeId({ kind: 'map' }, files), null)
  assert.equal(targetNodeId({ kind: 'catchup' }, files), null)

  assert.match(servesLine(task, nodes, record), /first useful session/)
  const amended = amendTree(nodes, 'Favor keyboard-first capture.', 'journey', built.now).nodes
  const amendment = amended.find((node) => node.kind === 'amendment')!
  const amendmentFile = deriveFiles({ ...base(built), nodes: amended }).find((file) => file.nodeId === amendment.id)!
  assert.match(amendmentFile.path, /^direction\/amendments\//)
  assert.equal(amendmentFile.title, 'Favor keyboard-first capture.')
})

test('the catch-up report is priority-descending, time-filtered, and capped per section', () => {
  // Stop before the closing run so a hypothesis is still provisional.
  const built = build(13)
  const { nodes, confirmedAt, now, progress } = built
  const files = deriveFiles(base(built))
  const midway = nodes.find((node) => node.id === 'quality')!.createdAt

  const full = buildCatchUp({ nodes, files, since: confirmedAt, now, progress })
  assert.equal(full.progress.met, 1, 'only boundaries hold this early')
  assert.deepEqual(full.sections.map((section) => section.title), ['Needs you', 'Direction changed', 'Finished', 'In progress', 'Opened'].filter((title) =>
    full.sections.some((section) => section.title === title)))
  assert.equal(full.sections[0]!.title, 'Needs you')
  assert.match(full.sections[0]!.items[0]!.text, /Working hypothesis awaits/)
  assert.ok(full.sections.every((section) => section.items.length <= SECTION_CAP))
  const opened = full.sections.find((section) => section.title === 'Opened')!
  assert.equal(opened.items.length + opened.more, 5, 'four scopes and the attached evidence')
  for (const section of full.sections) {
    for (let index = 1; index < section.items.length; index += 1) assert.ok(section.items[index - 1]!.at >= section.items[index]!.at, 'most recent first')
  }

  const later = buildCatchUp({ nodes, files, since: midway, now, progress })
  assert.ok(later.total < full.total, 'a later baseline shows less')
  assert.ok(later.sections.find((section) => section.title === 'Finished')!.items.some((item) => /Runnable shell/.test(item.text)))
  assert.ok(!later.sections.find((section) => section.title === 'Opened')?.items.some((item) => /Foundation/.test(item.text)), 'old scopes are not re-reported')
  assert.equal(later.sections[0]!.title, 'Needs you', 'standing needs survive any baseline')

  const amended = amendTree(nodes, 'Ship dark theme first.', 'shell', now + MINUTE).nodes
  const withAmendment = buildCatchUp({ nodes: amended, files, since: now, now: now + 2 * MINUTE, progress })
  assert.match(withAmendment.sections.find((section) => section.title === 'Direction changed')!.items[0]!.text, /Amended “Runnable shell”: Ship dark theme/)
  assert.equal(countSince(amended, now), 2, 'the amendment and its target both count as changed')
  const quiet = buildCatchUp({ nodes, files, since: now, now: now + MINUTE, progress })
  assert.deepEqual(quiet.sections.map((section) => section.title), ['Needs you'], 'only standing needs remain when nothing moved')
  assert.equal(quiet.total, 1)

  assert.equal(relative(now - 3 * MINUTE, now), '3m ago')
  assert.equal(relative(now - 20_000, now), 'just now')
  assert.equal(duration(90 * MINUTE), '2 hours')
  assert.equal(duration(12 * MINUTE), '12 minutes')
})
