import { BROWSER_PANE_ID, chatPaneIds, DEFAULT_BROWSER_SPLIT_RATIO, type ChatLayout, type Rect } from '../layout-tree.js'
import type { CanvasSize } from '../layout-presets.js'
import { linkFloatingPair, flushPairRects } from './floating-pair.js'
import { findWindow, floatWindow, restoreWindow } from './window-layout.js'

export const BROWSER_SPLIT_ID = 'closedai:browser-split'
export { DEFAULT_BROWSER_SPLIT_RATIO }

/** The out-of-box chat+browser tree before the user moves or resizes anything. */
export function isPristineBrowserSplit(tree: ChatLayout): boolean {
  if (tree.kind !== 'split' || tree.id !== BROWSER_SPLIT_ID || tree.axis !== 'horizontal') return false
  if (Math.abs(tree.ratio - DEFAULT_BROWSER_SPLIT_RATIO) > 1e-6) return false
  const { first, second } = tree
  if (first.kind !== 'pane' || second.kind !== 'pane' || second.id !== BROWSER_PANE_ID) return false
  if (first.float || second.float || first.docked || second.docked) return false
  return chatPaneIds(tree).length === 1
}

/**
 * Floating rects for the default workspace: a narrower chat left, a larger browser right, with
 * desktop margin so the wallpaper shows — matching the compact starting layout.
 */
export function defaultFloatingRects(canvas: CanvasSize): { chat: Rect; browser: Rect } {
  // A 30/70 pair occupying about 76% of the desktop width, flush seam for the pair divider.
  const pairWidth = Math.max(300 + 384, Math.round(canvas.width * 0.76))
  const chatWidth = Math.max(300, Math.round(pairWidth * 0.30))
  const browserWidth = pairWidth - chatWidth
  const height = Math.max(280, Math.round(canvas.height * 0.76))
  const chatX = Math.max(0, Math.round((canvas.width - pairWidth) * 0.8))
  const chatY = Math.max(0, Math.round((canvas.height - height) * 0.4))
  return flushPairRects(
    { x: chatX, y: chatY, width: chatWidth, height },
    { x: chatX + chatWidth, y: chatY, width: browserWidth, height }
  )
}

/** Lift the pristine chat and browser off the full canvas into `defaultFloatingRects`. */
export function applyWorkspaceDefaultFloat(tree: ChatLayout, canvas: CanvasSize): ChatLayout {
  if (!isPristineBrowserSplit(tree) || canvas.width <= 0 || canvas.height <= 0) return tree
  const chatId = chatPaneIds(tree)[0]!
  const rects = defaultFloatingRects(canvas)
  const visit = (node: ChatLayout): ChatLayout => {
    if (node.kind === 'split') return { ...node, first: visit(node.first), second: visit(node.second) }
    if (node.id === chatId) return { ...node, float: { ...rects.chat, z: 1 } }
    if (node.id === BROWSER_PANE_ID) return { ...node, float: { ...rects.browser, z: 2 } }
    return node
  }
  return linkFloatingPair(visit(tree), chatId)
}

const rectNear = (a: Rect, b: Rect): boolean =>
  Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1
  && Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1

/** Whether `chatId` and the browser float as the default side-by-side pair on this canvas. */
export function isDefaultFloatingChatBrowserPair(tree: ChatLayout, canvas: CanvasSize, chatId: string): boolean {
  if (canvas.width <= 0 || canvas.height <= 0) return false
  const chat = findWindow(tree, chatId)?.float
  const browser = findWindow(tree, BROWSER_PANE_ID)?.float
  if (!chat || !browser || findWindow(tree, chatId)?.docked || findWindow(tree, BROWSER_PANE_ID)?.docked) return false
  const expected = defaultFloatingRects(canvas)
  return rectNear(chat, expected.chat) && rectNear(browser, expected.browser)
}

/**
 * Put the selected chat and browser back in the compact floating pair (30/70, wallpaper margin).
 * Other windows are untouched; minimized chat/browser are restored first.
 */
export function restoreFloatingChatBrowserPair(tree: ChatLayout, canvas: CanvasSize, chatId: string): ChatLayout | null {
  if (canvas.width <= 0 || canvas.height <= 0) return null
  if (!findWindow(tree, chatId) || !findWindow(tree, BROWSER_PANE_ID)) return null
  const rects = defaultFloatingRects(canvas)
  let next = tree
  if (findWindow(next, chatId)?.docked) next = restoreWindow(next, chatId)
  if (findWindow(next, BROWSER_PANE_ID)?.docked) next = restoreWindow(next, BROWSER_PANE_ID)
  next = floatWindow(next, chatId, rects.chat)
  next = floatWindow(next, BROWSER_PANE_ID, rects.browser)
  return linkFloatingPair(next, chatId)
}
