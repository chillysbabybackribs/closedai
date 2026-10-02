import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID } from './layout-tree.ts'
import { isChatCardPane, replaceChatCardPane, separateChatCards } from './chat-cards.ts'
import { chatTabIds } from './layout-tabs.ts'
import { getFloatingPair } from './floating/floating-pair.ts'
import { windowPanes } from './floating/window-layout.ts'
import type { ChatLayout } from './layout-tree.ts'

test('legacy grouped chats become separate cards without losing history identities or window state', () => {
  const tree: ChatLayout = { kind: 'pane', id: 'b', tabs: ['a', 'b', 'c'], onTop: true,
    float: { x: 10, y: 20, width: 560, height: 720, z: 3 } }
  const result = separateChatCards(tree)
  assert.deepEqual(chatTabIds(result).sort(), ['a', 'b', 'c'])
  const cards = windowPanes(result)
  assert.equal(cards.length, 3)
  assert.deepEqual(cards[0]?.float, tree.float)
  assert.ok(cards.every((card) => card.tabs?.length === 1 && card.onTop))
  assert.equal(separateChatCards(result), result, 'normalization is stable')
})

test('replaceChatCardPane keeps float geometry and browser pair linkage', () => {
  const tree: ChatLayout = {
    kind: 'split', id: 'pair', axis: 'horizontal', ratio: 0.3,
    first: { kind: 'pane', id: 'old', float: { x: 100, y: 40, width: 400, height: 600, z: 2 }, floatPair: 'old' },
    second: { kind: 'pane', id: BROWSER_PANE_ID, float: { x: 500, y: 40, width: 900, height: 600, z: 3 }, floatPair: 'old' }
  }
  assert.ok(isChatCardPane(tree, 'old'))
  const next = replaceChatCardPane(tree, 'old', 'fresh')
  assert.deepEqual(getFloatingPair(next)?.chatId, 'fresh')
  const card = windowPanes(next).find((pane) => pane.id === 'fresh')
  assert.deepEqual(card?.float, tree.first.float)
})

test('view tab groups and single chat cards remain untouched', () => {
  const view: ChatLayout = { kind: 'pane', id: 'closedai:view:note:a', tabs: ['closedai:view:note:a', 'closedai:view:note:b'] }
  assert.equal(separateChatCards(view), view)
  const card: ChatLayout = { kind: 'pane', id: 'a' }
  assert.equal(separateChatCards(card), card)
})

test('single chat cards normalize when pane id differs from the open tab id', () => {
  const tree: ChatLayout = { kind: 'pane', id: 'owner', tabs: ['visible-old'] }
  const normalized = separateChatCards(tree)
  assert.equal(normalized.kind === 'pane' && normalized.id, 'visible-old')
  assert.ok(isChatCardPane(normalized, 'visible-old'))
  const next = replaceChatCardPane(normalized, 'visible-old', 'fresh')
  assert.deepEqual(chatTabIds(next), ['fresh'])
  assert.equal(windowPanes(next)[0]?.id, 'fresh')
})
