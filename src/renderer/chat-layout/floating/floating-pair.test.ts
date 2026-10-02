import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID, withBrowser } from '../layout-tree.ts'
import { applyWorkspaceDefaultFloat } from './workspace-default-float.ts'
import { getFloatingPair, linkFloatingPair, resizeFloatingPairDivider } from './floating-pair.ts'

const canvas = { width: 1600, height: 900 }

test('linked pair exposes a divider and keeps the browser flush to the chat', () => {
  const tree = applyWorkspaceDefaultFloat(withBrowser({ kind: 'pane', id: 'a' }), canvas)
  const pair = getFloatingPair(tree)
  assert.ok(pair)
  assert.equal(pair!.browser.x, pair!.chat.x + pair!.chat.width)
  const wider = resizeFloatingPairDivider(tree, 'a', pair!.chat.width + 60, canvas)
  assert.ok(wider)
  const next = getFloatingPair(wider!)!
  assert.equal(next.chat.width, pair!.chat.width + 60)
  assert.equal(next.browser.x, next.chat.x + next.chat.width)
})

test('getFloatingPair requires the floatPair flag on both panes', () => {
  const chat = { kind: 'pane' as const, id: 'a', float: { x: 10, y: 10, width: 400, height: 500, z: 1 } }
  const browser = { kind: 'pane' as const, id: BROWSER_PANE_ID, float: { x: 410, y: 10, width: 600, height: 500, z: 2 } }
  const tree = { kind: 'split' as const, id: 's', axis: 'horizontal' as const, ratio: 0.5, first: chat, second: browser }
  assert.equal(getFloatingPair(tree), null)
  assert.ok(getFloatingPair(linkFloatingPair(tree, 'a')))
})
