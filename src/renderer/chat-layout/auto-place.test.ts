import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID, layoutGeometry, type ChatLayout } from './layout-tree.ts'
import { autoPlace, autoPlacement } from './auto-place.ts'
import { floatWindow, minimizeWindow } from './floating/window-layout.ts'

const pane = (id: string): ChatLayout => ({ kind: 'pane', id })
const row = (id: string, ratio: number, first: ChatLayout, second: ChatLayout): ChatLayout =>
  ({ kind: 'split', id, axis: 'horizontal', ratio, first, second })
// Chat, browser, chat: the "browser between" preset on a 1600x900 canvas.
const between = row('outer', 0.29, pane('left'), row('inner', 0.59, pane(BROWSER_PANE_ID), pane('right')))
const canvas = { width: 1600, height: 900, browserVisible: true }
let ids = 0
const nextId = (): string => `split-${++ids}`

const tiles = (tree: ChatLayout) => layoutGeometry(tree, canvas.width, canvas.height).panes
  .map((tile) => ({ id: tile.id, x: Math.round(tile.rect.x), y: Math.round(tile.rect.y), w: Math.round(tile.rect.width), h: Math.round(tile.rect.height) }))

test('full-height side chats are halved top and bottom one at a time, then the halves split side by side', () => {
  let tree = autoPlace(between, 'n1', canvas, nextId(), 'left')!
  let placed = tiles(tree).find((tile) => tile.id === 'n1')!
  const left = tiles(tree).find((tile) => tile.id === 'left')!
  assert.equal(placed.x, left.x, 'the new chat sits under the chat it halved')
  assert.ok(placed.y > left.y && placed.h === left.h)

  tree = autoPlace(tree, 'n2', canvas, nextId(), 'left')!
  placed = tiles(tree).find((tile) => tile.id === 'n2')!
  const right = tiles(tree).find((tile) => tile.id === 'right')!
  assert.equal(placed.x, right.x, 'the other full-height chat is halved next, whatever is selected')
  assert.ok(placed.y > right.y)

  // Every side tile is now a quarter; on a wide enough canvas one of them splits side by side.
  const wide = { ...canvas, width: 2560, height: 1000 }
  const next = autoPlacement(tree, 'n3', wide, 'n2')
  assert.deepEqual(next && [next.target, next.edge], ['n2', 'right'])
})

test('the browser is never split, and a hidden browser leaves its room to the chats', () => {
  const side = row('outer', 0.4, pane('chat'), pane(BROWSER_PANE_ID))
  assert.equal(autoPlacement(side, 'n1', canvas)?.target, 'chat')
  const hidden = autoPlacement(side, 'n1', { ...canvas, browserVisible: false })
  assert.deepEqual(hidden && [hidden.target, hidden.edge, Math.round(hidden.rect.width)], ['chat', 'right', 793])
})

test('floating and minimized windows are not split, and nothing fits means float instead', () => {
  const two = row('outer', 0.5, pane('a'), pane('b'))
  assert.equal(autoPlacement(floatWindow(two, 'a', { x: 0, y: 0, width: 400, height: 400 }), 'n', canvas)?.target, 'b')
  assert.equal(autoPlacement(minimizeWindow(two, 'b'), 'n', canvas)?.target, 'a')
  assert.equal(autoPlacement(two, 'n', { width: 620, height: 500, browserVisible: true }), null)
  assert.equal(autoPlacement(two, 'n', { width: 0, height: 0, browserVisible: true }), null)
  assert.equal(autoPlace(null, 'n', canvas, nextId()), null)
})
