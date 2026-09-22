import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceDiscovery, createDiscovery } from './project-discovery.ts'
import { amendTree, applyEvent, buildDispatchPlan, layoutTree, NODE_WIDTH, rootNode, type TreeNode } from './project-tree.ts'

function confirmedRecord() {
  let state = createDiscovery()
  for (const answer of [
    'A desktop research tool for journalists that links captured source pages to claims.',
    'Investigative journalists at small newsrooms.',
    'Capture a source page and link it to one claim in a draft.',
    'Not a general note app; offline-first and citations are non-negotiable.'
  ]) state = advanceDiscovery(state, answer).state
  return state.record
}

test('layout centres parents over children and keeps siblings apart', () => {
  const nodes: TreeNode[] = [
    { id: 'r', kind: 'root', state: 'anchored', title: 'r', summary: '', detail: '', createdAt: 0, updatedAt: 0 },
    { id: 'a', parent: 'r', kind: 'scope', state: 'active', title: 'a', summary: '', detail: '', createdAt: 0, updatedAt: 0 },
    { id: 'b', parent: 'r', kind: 'scope', state: 'active', title: 'b', summary: '', detail: '', createdAt: 0, updatedAt: 0 },
    { id: 'a1', parent: 'a', kind: 'task', state: 'active', title: 'a1', summary: '', detail: '', createdAt: 0, updatedAt: 0 },
    { id: 'a2', parent: 'a', kind: 'task', state: 'active', title: 'a2', summary: '', detail: '', createdAt: 0, updatedAt: 0 }
  ]
  const layout = layoutTree(nodes)
  const at = (id: string) => layout.nodes.find((node) => node.id === id)!
  assert.equal(at('r').depth, 0)
  assert.equal(at('a1').depth, 2)
  assert.ok(at('a2').x - at('a1').x >= NODE_WIDTH, 'siblings do not overlap')
  assert.ok(at('b').x - at('a').x >= NODE_WIDTH)
  assert.equal(at('a').x, (at('a1').x + at('a2').x) / 2, 'parent centred over its children')
  assert.equal(at('r').x, (at('a').x + at('b').x) / 2)
  assert.ok(at('a1').y > at('a').y && at('a').y > at('r').y, 'depth grows downward')
  assert.ok(layout.width >= at('b').x + NODE_WIDTH)
})

test('the dispatch plan grows a tree from the root using the confirmed record', () => {
  const record = confirmedRecord()
  let nodes = [rootNode(record, 1_000)]
  assert.equal(nodes[0]!.links?.length, 3, 'root carries discovery evidence')
  let at = 1_000
  let mid: TreeNode[] = []
  for (const [index, event] of buildDispatchPlan(record).entries()) {
    nodes = applyEvent(nodes, event, at += event.delay)
    if (index === 12) mid = nodes
  }
  const shell = nodes.find((node) => node.id === 'shell')!
  assert.ok(shell.updatedAt > shell.createdAt, 'an update stamps updatedAt after createdAt')
  const ids = new Set(nodes.map((node) => node.id))
  for (const node of nodes) if (node.parent) assert.ok(ids.has(node.parent), `${node.id} has a placed parent`)
  assert.equal(nodes.find((node) => node.id === 'shell')?.state, 'complete')
  assert.equal(nodes.find((node) => node.id === 'journey-proto')?.state, 'complete', 'the plan runs through to a closable build')
  assert.ok(nodes.every((node) => node.kind !== 'research' || node.state === 'confirmed'), 'every unknown is resolved by the end')
  assert.equal(nodes.find((node) => node.id === 'evidence')?.links?.length, 3)
  assert.match(nodes.find((node) => node.id === 'journey')!.detail, /link it to one claim/)

  const amended = amendTree(mid, 'Favor keyboard-first capture.', 'journey', at + 5_000)
  const amendment = amended.nodes.find((node) => node.kind === 'amendment')
  assert.equal(amendment?.parent, 'journey')
  assert.match(amended.note, /2 continuing · 1 adapting next/)
  assert.equal(amended.nodes.find((node) => node.id === 'root')?.detail, mid[0]!.detail, 'root record untouched')
  assert.equal(amended.nodes.find((node) => node.id === 'journey')?.updatedAt, at + 5_000, 'target is stamped as changed')
})
