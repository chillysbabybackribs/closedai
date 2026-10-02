import assert from 'node:assert/strict'
import test from 'node:test'
import { BROWSER_PANE_ID, withBrowser } from '../layout-tree.ts'
import {
  applyWorkspaceDefaultFloat, defaultFloatingRects, isDefaultFloatingChatBrowserPair, isPristineBrowserSplit,
  restoreFloatingChatBrowserPair
} from './workspace-default-float.ts'
import { floatWindow, floatingWindows } from './window-layout.ts'

const canvas = { width: 1600, height: 900 }

test('isPristineBrowserSplit matches withBrowser on a single chat', () => {
  assert.equal(isPristineBrowserSplit(withBrowser({ kind: 'pane', id: 'a' })), true)
  assert.equal(isPristineBrowserSplit(withBrowser({ kind: 'pane', id: 'a', float: { x: 0, y: 0, width: 400, height: 400, z: 1 } })), false)
})

test('applyWorkspaceDefaultFloat lifts chat and browser with mockup proportions', () => {
  const tree = applyWorkspaceDefaultFloat(withBrowser({ kind: 'pane', id: 'a' }), canvas)
  const floats = floatingWindows(tree)
  assert.equal(floats.length, 2)
  const chat = floats.find((pane) => pane.id === 'a')!.float
  const browser = floats.find((pane) => pane.id === BROWSER_PANE_ID)!.float
  const expected = defaultFloatingRects(canvas)
  assert.deepEqual(chat, { ...expected.chat, z: 1 })
  assert.deepEqual(browser, { ...expected.browser, z: 2 })
  assert.ok(chat.width < canvas.width * 0.4)
  assert.ok(browser.width < canvas.width * 0.6)
})


test('default pair matches the reference desktop composition without overlap', () => {
  const { chat, browser } = defaultFloatingRects({ width: 2560, height: 1000 })
  assert.equal(chat.height, 760)
  assert.equal(browser.height, chat.height)
  assert.equal(browser.y, chat.y)
  assert.equal(browser.x, chat.x + chat.width)
  assert.ok(chat.x > 400)
  assert.ok(browser.x + browser.width < 2560)
  assert.ok(chat.y > 0 && chat.y + chat.height < 1000)
  assert.ok(Math.abs(chat.width / (chat.width + browser.width) - 0.3) < 0.001)
})

test('restoreFloatingChatBrowserPair resets a scattered chat and browser to the default pair', () => {
  const initial = applyWorkspaceDefaultFloat(withBrowser({ kind: 'pane', id: 'a' }), canvas)
  const scattered = floatingWindows(initial).reduce((tree, pane) => {
    if (pane.id === 'a') return floatWindow(tree, 'a', { x: 40, y: 40, width: 420, height: 500 })
    if (pane.id === BROWSER_PANE_ID) return floatWindow(tree, BROWSER_PANE_ID, { x: 900, y: 120, width: 500, height: 400 })
    return tree
  }, initial)
  assert.equal(isDefaultFloatingChatBrowserPair(scattered, canvas, 'a'), false)
  const restored = restoreFloatingChatBrowserPair(scattered, canvas, 'a')
  assert.ok(restored)
  assert.equal(isDefaultFloatingChatBrowserPair(restored!, canvas, 'a'), true)
})

test('default initialization preserves a customized workspace', () => {
  const initial = withBrowser({ kind: 'pane', id: 'a' })
  const floated = applyWorkspaceDefaultFloat(initial, canvas)
  assert.equal(applyWorkspaceDefaultFloat(floated, { width: 2560, height: 1000 }), floated)
  const resized = { ...initial, ratio: 0.45 }
  assert.equal(applyWorkspaceDefaultFloat(resized, canvas), resized)
})
