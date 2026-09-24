import assert from 'node:assert/strict'
import test from 'node:test'
import { closesOnFocusOut, closesOnPointerDown, cursorIndex, type NodeLike } from './header-search-dismiss.js'

function node(children: NodeLike[] = []): NodeLike {
  const self: NodeLike = { contains: (other) => other === self || children.some((child) => child.contains(other)) }
  return self
}

test('focus leaving the component closes; focus moving within it does not', () => {
  const input = node()
  const row = node()
  const root = node([input, row])
  const elsewhere = node()
  assert.equal(closesOnFocusOut(root, null), true)
  assert.equal(closesOnFocusOut(root, elsewhere), true)
  assert.equal(closesOnFocusOut(root, row), false)
  assert.equal(closesOnFocusOut(root, input), false)
})

test('a press outside closes; a press on the popup or field does not', () => {
  const popup = node()
  const root = node([popup])
  assert.equal(closesOnPointerDown(root, node()), true)
  assert.equal(closesOnPointerDown(root, null), true)
  assert.equal(closesOnPointerDown(root, popup), false)
  assert.equal(closesOnPointerDown(root, root), false)
})

test('the cursor follows the highlighted chat across reorders and falls back to the first row', () => {
  assert.equal(cursorIndex(['a', 'b', 'c'], 'c'), 2)
  assert.equal(cursorIndex(['c', 'a', 'b'], 'c'), 0)
  assert.equal(cursorIndex(['a', 'b'], 'gone'), 0)
  assert.equal(cursorIndex(['a', 'b'], null), 0)
  assert.equal(cursorIndex([], 'a'), 0)
})
