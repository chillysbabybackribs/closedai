import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceDiscovery, createDiscovery } from './project-discovery.ts'
import { breadcrumbs, deriveFiles, folderTree, servesLine, targetNodeId } from './project-files.ts'
import type { Message } from './project-intake.ts'
import { amendTree, applyEvent, buildDispatchPlan, rootNode } from './project-tree.ts'

function build() {
  let state = createDiscovery()
  const messages: Message[] = []
  for (const answer of [
    'A desktop research tool for journalists that links captured source pages to claims.',
    'Investigative journalists at small newsrooms.',
    'Capture a source page and link it to one claim in a draft.',
    'Not a general note app; offline-first and citations are non-negotiable.'
  ]) {
    messages.push({ id: messages.length, role: 'user', text: answer })
    const next = advanceDiscovery(state, answer)
    state = next.state
    messages.push({ id: messages.length, role: 'coordinator', text: next.reply })
  }
  const record = state.record
  let nodes = [rootNode(record)]
  for (const event of buildDispatchPlan(record)) nodes = applyEvent(nodes, event)
  return { record, messages, nodes }
}

test('files are derived from the record, transcript, map, and journal, with edits layered on top', () => {
  const { record, messages, nodes } = build()
  const files = deriveFiles({ record, messages, nodes, journal: [{ id: 1, text: 'Direction confirmed.' }], edits: {} })
  const paths = files.map((file) => file.path)
  assert.ok(paths.includes('request.md') && paths.includes('direction/record.md') && paths.includes('direction/transcript.md'))
  assert.ok(paths.includes('journal/log.md') && paths.includes('research/discovery-sources.md'))
  assert.ok(paths.some((path) => /^scopes\/[^/]+\/plan\.md$/.test(path)), 'each scope gets a plan')
  assert.ok(paths.some((path) => /^scopes\/[^/]+\/tasks\/[^/]+\/notes\.md$/.test(path)), 'each task gets worker notes')
  assert.equal(new Set(paths).size, paths.length, 'paths are unique')

  const request = files.find((file) => file.path === 'request.md')!
  assert.equal(request.editable, false, 'original words are history')
  assert.match(request.content, /links captured source pages to claims/)
  assert.equal(files.find((file) => file.path === 'direction/record.md')!.editable, true)
  assert.equal(files.find((file) => file.path === 'direction/transcript.md')!.content.match(/\*\*You\*\*/g)?.length, 4)

  const edited = deriveFiles({ record, messages, nodes, journal: [], edits: { 'direction/record.md': '# Direction record\n\nrewritten' } })
  assert.equal(edited.find((file) => file.path === 'direction/record.md')!.content, '# Direction record\n\nrewritten')
  assert.equal(edited.find((file) => file.path === 'request.md')!.content, request.content, 'edits touch only their file')
})

test('the folder tree nests by path and every file belongs to a map node', () => {
  const { record, messages, nodes } = build()
  const files = deriveFiles({ record, messages, nodes, journal: [], edits: {} })
  const root = folderTree(files)
  assert.deepEqual(root.files.map((file) => file.path), ['request.md'])
  const scopes = root.folders.find((folder) => folder.name === 'scopes')!
  assert.ok(scopes.folders.length >= 2)
  const journey = scopes.folders.find((folder) => folder.name === 'journey')!
  assert.equal(journey.path, 'scopes/journey')
  assert.ok(journey.folders.find((folder) => folder.name === 'tasks'))
  const ids = new Set(nodes.map((node) => node.id))
  for (const file of files) assert.ok(ids.has(file.nodeId), `${file.path} points at a real node`)
})

test('breadcrumbs trace nodes to the root and files to their folders; direction lands on the owning node', () => {
  const { record, messages, nodes } = build()
  const files = deriveFiles({ record, messages, nodes, journal: [], edits: {} })
  const task = nodes.find((node) => node.id === 'journey-proto')!
  const nodeCrumbs = breadcrumbs({ kind: 'node', id: task.id }, nodes, files)
  assert.deepEqual(nodeCrumbs.map((crumb) => crumb.label).slice(0, 1), ['Map'])
  assert.equal(nodeCrumbs.at(-1)!.label, task.title)
  assert.equal(nodeCrumbs.length, 4, 'Map › root › scope › task')

  const notes = `scopes/journey/tasks/${task.id}/notes.md`
  const fileCrumbs = breadcrumbs({ kind: 'file', path: notes }, nodes, files)
  assert.deepEqual(fileCrumbs.map((crumb) => crumb.label), ['Files', 'scopes', 'journey', 'tasks', task.id, task.title])
  assert.equal(targetNodeId({ kind: 'file', path: notes }, files), task.id)
  assert.equal(targetNodeId({ kind: 'file', path: 'direction/record.md' }, files), 'root')
  assert.equal(targetNodeId({ kind: 'map' }, files), null)

  assert.match(servesLine(task, nodes, record), /first useful session/)
  const amended = amendTree(nodes, 'Favor keyboard-first capture.', 'journey').nodes
  const amendment = amended.find((node) => node.kind === 'amendment')!
  assert.match(deriveFiles({ record, messages, nodes: amended, journal: [], edits: {} })
    .find((file) => file.nodeId === amendment.id)!.path, /^direction\/amendments\//)
})
